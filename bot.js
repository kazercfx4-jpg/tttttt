const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ChannelType,
  PermissionsBitField,
  ActivityType,
} = require("discord.js")
const fs = require("fs").promises
const path = require("path")
const crypto = require("crypto")
const { spawn } = require("child_process")

// Structure de traduction multilingue
const TRANSLATIONS = {
  fr: {
    welcome: "Bienvenue sur le bot FSProtect !",
    ticket_created: "Votre ticket a été créé.",
    ticket_closed: "Votre ticket a été fermé.",
    transcript_saved: "Transcript sauvegardé.",
    access_granted: "Accès au bot accordé !",
    file_encrypted: "Fichier obfusqué avec succès.",
    error: "Une erreur est survenue.",
    no_permission: "Vous n'avez pas la permission.",
    already_ticket: "Vous avez déjà un ticket ouvert.",
    ticket_type_technical: "Support Technique",
    ticket_type_billing: "Support Billing",
    ticket_type_general: "Questions Générales",
    file_too_large: "Le fichier est trop volumineux.",
    file_not_supported: "Extension de fichier non supportée.",
    limit_reached: "Limite mensuelle atteinte.",
    access_expired: "Accès expiré.",
    no_access: "Aucun accès configuré.",
    bot_started: "Bot démarré avec succès !",
    bot_stopped: "Bot arrêté proprement.",
    ticket_will_close: "Le ticket sera fermé dans 10 secondes...",
    dm_obfuscation_error: "Une erreur est survenue lors de l'obfuscation du fichier.",
    ticket_panel_title: "Support Tickets",
    ticket_panel_desc: "Cliquez sur un bouton ci-dessous pour créer un ticket selon votre besoin.",
    ticket_panel_footer: "Un seul ticket par utilisateur à la fois",
  },
  en: {
    welcome: "Welcome to the FSProtect bot!",
    ticket_created: "Your ticket has been created.",
    ticket_closed: "Your ticket has been closed.",
    transcript_saved: "Transcript saved.",
    access_granted: "Bot access granted!",
    file_encrypted: "File obfuscated successfully.",
    error: "An error occurred.",
    no_permission: "You do not have permission.",
    already_ticket: "You already have an open ticket.",
    ticket_type_technical: "Technical Support",
    ticket_type_billing: "Billing Support",
    ticket_type_general: "General Questions",
    file_too_large: "The file is too large.",
    file_not_supported: "File extension not supported.",
    limit_reached: "Monthly limit reached.",
    access_expired: "Access expired.",
    no_access: "No access configured.",
    bot_started: "Bot started successfully!",
    bot_stopped: "Bot stopped cleanly.",
    ticket_will_close: "The ticket will be closed in 10 seconds...",
    dm_obfuscation_error: "An error occurred during file obfuscation.",
    ticket_panel_title: "Support Tickets",
    ticket_panel_desc: "Click a button below to create a ticket for your need.",
    ticket_panel_footer: "Only one ticket per user at a time",
  },
}

// Fonction utilitaire pour récupérer le texte traduit
function t(key, lang = "fr") {
  return TRANSLATIONS[lang]?.[key] || TRANSLATIONS["fr"][key] || key
}

// Import des handlers de commandes
const { handleInteraction, registerCommands } = require('./commandes.js')

// Configuration
const CONFIG = {
  botToken: process.env.BOT_TOKEN || "TOKEN_HERE",
  defaultLang: "fr",
  adminRoleId: process.env.ADMIN_ROLE_ID || "1413657252384211065",
  supportRoleId: process.env.SUPPORT_ROLE_ID || "1413699924222279743",
  ownerId: process.env.OWNER_ID || ["1306267120316710985", "1303496465360093224", "1286468031375212584"],
  clientsFile: path.join(__dirname, "data", "clients.json"),
  accessTypesFile: path.join(__dirname, "data", "access_types.json"),
  ticketsFile: path.join(__dirname, "data", "tickets.json"),
  moderationFile: path.join(__dirname, "data", "moderation.json"),
  ticketCategoryId: process.env.TICKET_CATEGORY_ID || null,
  tempDir: path.join(__dirname, "temp"),
  prometheusPath: path.join(__dirname, "prometheus-main.lua"),
  maxFileSize: 50 * 1024 * 1024, // 50MB
  allowedExtensions: [".lua", ".js", ".json", ".txt", ".md", ".zip", ".rar"],
  logChannels: {
    tickets: null,
    messages: null,
    vocals: null,
    pings: null,
    roles: null,
    raids: null,
    moderator: null,
    antilink: null,
    access: null,
    general: null,
  },
  logCategoryName: "📋 LOGS FSProtect",
}

// Base de données en mémoire
let clients = new Map()
let accessTypes = new Map()
let tickets = new Map()
let moderationData = {
  warnings: new Map(),
  blacklist: new Set(),
  whitelist: new Set(),
  automod: {
    antilink: true,
    antiping: true,
    antiraid: true,
    antibot: true,
  },
  mutedUsers: new Map(),
}

const botStats = {
  totalFiles: 0,
  totalUsers: 0,
  filesThisMonth: 0,
  startTime: new Date(),
}

let logs = []
const ticketTypes = new Map()
let maintenanceMode = false
let commandsRegistered = false

// Client Discord
const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
  ],
  partials: ["CHANNEL", "MESSAGE", "REACTION"],
})

// Gestionnaires d'erreurs globaux
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  addLog("error", `Unhandled rejection: ${reason}`)
})

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  addLog("error", `Uncaught exception: ${error.message}`)
  saveData().finally(() => process.exit(1))
})

discordClient.on('error', error => {
  console.error('Discord client error:', error)
  addLog("error", `Discord client error: ${error.message}`)
})

discordClient.on('warn', warning => {
  console.warn('Discord client warning:', warning)
})

// Créer les dossiers nécessaires
async function initDirectories() {
  const dirs = [
    path.join(__dirname, "data"), 
    CONFIG.tempDir, 
    path.join(__dirname, "data", "transcripts")
  ]

  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch (error) {
      if (error.code !== "EEXIST") {
        console.error(`Erreur création dossier ${dir}:`, error.message)
      }
    }
  }

  // Créer les fichiers par défaut s'ils n'existent pas
  const defaultFiles = [
    {
      path: CONFIG.clientsFile,
      content: {}
    },
    {
      path: CONFIG.accessTypesFile,
      content: {
        basic: {
          name: "Basic",
          filesPerMonth: 10,
          description: "Accès basique - 10 fichiers par mois",
        },
        premium: {
          name: "Premium",
          filesPerMonth: 50,
          description: "Accès premium - 50 fichiers par mois",
        },
        unlimited: {
          name: "Unlimited",
          filesPerMonth: -1,
          description: "Accès illimité",
        },
      }
    },
    {
      path: CONFIG.ticketsFile,
      content: {}
    },
    {
      path: CONFIG.moderationFile,
      content: {
        warnings: {},
        blacklist: [],
        whitelist: [],
        automod: {
          antilink: true,
          antiping: true,
          antiraid: true,
          antibot: true,
        },
        mutedUsers: {},
      }
    }
  ]

  for (const file of defaultFiles) {
    try {
      await fs.access(file.path)
    } catch {
      await fs.writeFile(file.path, JSON.stringify(file.content, null, 2))
    }
  }
}

// Charger les données depuis les fichiers
async function loadData() {
  try {
    await initDirectories()

    // Charger les clients
    try {
      const clientsData = await fs.readFile(CONFIG.clientsFile, "utf8")
      const parsedClients = JSON.parse(clientsData)
      clients = new Map(Object.entries(parsedClients))
    } catch (error) {
      console.log("Format de clients.json invalide, réinitialisation...")
      clients = new Map()
    }

    // Charger les types d'accès
    try {
      const accessData = await fs.readFile(CONFIG.accessTypesFile, "utf8")
      const parsedAccess = JSON.parse(accessData)
      accessTypes = new Map(Object.entries(parsedAccess))
    } catch (error) {
      console.log("Format de access_types.json invalide, réinitialisation...")
      accessTypes = new Map([
        ["basic", { name: "Basic", filesPerMonth: 10, description: "Accès basique - 10 fichiers par mois" }],
        ["premium", { name: "Premium", filesPerMonth: 50, description: "Accès premium - 50 fichiers par mois" }],
        ["unlimited", { name: "Unlimited", filesPerMonth: -1, description: "Accès illimité" }],
      ])
    }

    // Charger les tickets
    try {
      const ticketsData = await fs.readFile(CONFIG.ticketsFile, "utf8")
      const parsedTickets = JSON.parse(ticketsData)
      tickets = new Map(Object.entries(parsedTickets))
    } catch (error) {
      console.log("Format de tickets.json invalide, réinitialisation...")
      tickets = new Map()
    }

    // Charger les données de modération
    try {
      const moderationFileData = await fs.readFile(CONFIG.moderationFile, "utf8")
      const parsedModeration = JSON.parse(moderationFileData)
      moderationData = {
        warnings: new Map(Object.entries(parsedModeration.warnings || {})),
        blacklist: new Set(parsedModeration.blacklist || []),
        whitelist: new Set(parsedModeration.whitelist || []),
        automod: parsedModeration.automod || {
          antilink: true,
          antiping: true,
          antiraid: true,
          antibot: true,
        },
        mutedUsers: new Map(Object.entries(parsedModeration.mutedUsers || {})),
      }
    } catch (error) {
      console.log("Format de moderation.json invalide, réinitialisation...")
      moderationData = {
        warnings: new Map(),
        blacklist: new Set(),
        whitelist: new Set(),
        automod: { antilink: true, antiping: true, antiraid: true, antibot: true },
        mutedUsers: new Map(),
      }
    }

    await saveData()
  } catch (error) {
    console.error("Erreur lors du chargement des données:", error)
    throw error
  }
}

// Sauvegarder les données
async function saveData() {
  try {
    const promises = [
      fs.writeFile(CONFIG.clientsFile, JSON.stringify(Object.fromEntries(clients), null, 2)),
      fs.writeFile(CONFIG.accessTypesFile, JSON.stringify(Object.fromEntries(accessTypes), null, 2)),
      fs.writeFile(CONFIG.ticketsFile, JSON.stringify(Object.fromEntries(tickets), null, 2)),
      fs.writeFile(
        CONFIG.moderationFile,
        JSON.stringify(
          {
            warnings: Object.fromEntries(moderationData.warnings),
            blacklist: Array.from(moderationData.blacklist),
            whitelist: Array.from(moderationData.whitelist),
            automod: moderationData.automod,
            mutedUsers: Object.fromEntries(moderationData.mutedUsers),
          },
          null,
          2,
        ),
      )
    ]

    await Promise.all(promises)
  } catch (error) {
    console.error("Erreur lors de la sauvegarde:", error)
  }
}

// Ajouter une entrée de log
function addLog(type, message, userId = null) {
  const logEntry = {
    id: crypto.randomBytes(8).toString("hex"),
    timestamp: new Date().toISOString(),
    type: type,
    message: message,
    userId: userId,
  }

  logs.unshift(logEntry)

  // Garder seulement les 1000 derniers logs
  if (logs.length > 1000) {
    logs = logs.slice(0, 1000)
  }

  console.log(`[${type.toUpperCase()}] ${message}`)

  // Envoi dans le channel Discord si configuré
  try {
    const channelId = CONFIG.logChannels[type] || CONFIG.logChannels.general
    if (channelId && discordClient.channels) {
      const channel = discordClient.channels.cache.get(channelId)
      if (channel && channel.send) {
        const logMsg = `**[${type.toUpperCase()}]** ${message}${userId ? ` (User: <@${userId}>)` : ''}`
        channel.send({ content: logMsg }).catch(() => {})
      }
    }
  } catch (err) {
    console.error('Erreur envoi log Discord:', err)
  }
}

// Créer les canaux de logs
async function createLogChannels(guild) {
  try {
    console.log("Création des canaux de logs...")

    // Chercher ou créer la catégorie de logs
    let logCategory = guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildCategory && channel.name === CONFIG.logCategoryName,
    )

    if (!logCategory) {
      logCategory = await guild.channels.create({
        name: CONFIG.logCategoryName,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          {
            id: CONFIG.adminRoleId,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
          },
          {
            id: CONFIG.supportRoleId,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
          },
        ],
      })
      console.log("Catégorie de logs créée:", logCategory.name)
    }

    // Créer tous les channels de logs
    const logChannelNames = {
      tickets: "🎫-tickets-logs",
      messages: "💬-messages-logs",
      vocals: "🔊-vocals-logs",
      pings: "📢-pings-logs",
      roles: "👥-roles-logs",
      raids: "⚔️-raids-logs",
      moderator: "🛡️-moderator-logs",
      antilink: "🔗-antilink-logs",
      access: "🔑-access-logs",
      general: "📝-general-logs",
    }

    for (const [key, channelName] of Object.entries(logChannelNames)) {
      let channel = guild.channels.cache.find((ch) => ch.name === channelName && ch.parentId === logCategory.id)

      if (!channel) {
        channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: logCategory.id,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionsBitField.Flags.ViewChannel],
            },
            {
              id: CONFIG.adminRoleId,
              allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
            },
            {
              id: CONFIG.supportRoleId,
              allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
            },
          ],
        })
        console.log("Canal de logs créé:", channel.name)
      }

      CONFIG.logChannels[key] = channel.id
    }

    console.log("Tous les canaux de logs ont été créés avec succès")
    return true
  } catch (error) {
    console.error("Erreur lors de la création des canaux de logs:", error)
    return false
  }
}

// Envoyer un log dans le canal approprié
async function sendLog(logType, embed, guild) {
  try {
    if (!CONFIG.logChannels.hasOwnProperty(logType)) {
      console.error(`Type de canal de log ${logType} non trouvé`)
      return
    }

    const channelId = CONFIG.logChannels[logType]
    if (!channelId) {
      console.error(`Aucun ID de canal configuré pour le type de log ${logType}`)
      return
    }

    if (!guild) {
      guild = discordClient.guilds.cache.first()
    }

    if (!guild) {
      console.error(`Aucune guilde disponible pour les logs`)
      return
    }

    const channel = guild.channels.cache.get(channelId)

    if (!channel) {
      console.error(`Canal de log ${channelId} non trouvé dans la guilde`)
      return
    }

    // Valider l'embed avant l'envoi
    if (embed instanceof EmbedBuilder) {
      const embedData = embed.toJSON()

      // S'assurer que tous les champs sont des chaînes et pas trop longs
      if (embedData.fields) {
        embedData.fields = embedData.fields.map((field) => ({
          ...field,
          name: String(field.name).substring(0, 256),
          value: String(field.value).substring(0, 1024),
        }))
      }

      // S'assurer que le titre et la description ne sont pas trop longs
      if (embedData.title) {
        embedData.title = String(embedData.title).substring(0, 256)
      }
      if (embedData.description) {
        embedData.description = String(embedData.description).substring(0, 4096)
      }

      await channel.send({ embeds: [embedData] })
    } else {
      // Si c'est un message texte
      await channel.send({ content: String(embed).substring(0, 2000) })
    }
  } catch (error) {
    console.error(`Erreur lors de l'envoi du log vers ${logType}:`, error)
  }
}

// Event handlers du bot
discordClient.once("ready", async () => {
  console.log(`Bot connecté en tant que ${discordClient.user.tag}`)
  
  try {
    // Définir le statut du bot
    discordClient.user.setActivity("FSProtect | /help", { type: ActivityType.Watching })
    
    // Enregistrer les commandes slash (seulement une fois)
    if (!commandsRegistered) {
      console.log("Enregistrement des commandes slash...")
      await registerCommands(discordClient)
      commandsRegistered = true
      console.log("Commandes slash enregistrées")
    }

    // Créer les canaux de logs pour la première guilde
    const guild = discordClient.guilds.cache.first()
    if (guild) {
      await createLogChannels(guild)
    }

    addLog("info", `Bot ${discordClient.user.tag} prêt avec ${discordClient.guilds.cache.size} guilde(s)`)
  } catch (error) {
    console.error("Erreur lors de l'initialisation:", error)
    addLog("error", `Erreur d'initialisation: ${error.message}`)
  }
})

// Gestionnaire d'interactions avec protection contre les doublons
const processedInteractions = new Set()

discordClient.on("interactionCreate", async (interaction) => {
  // Prévenir le traitement multiple de la même interaction
  if (processedInteractions.has(interaction.id)) {
    return
  }
  processedInteractions.add(interaction.id)

  // Nettoyer les anciennes interactions (toutes les 5 minutes)
  setTimeout(() => {
    processedInteractions.delete(interaction.id)
  }, 300000)

  try {
    await handleInteraction(interaction, {
      CONFIG,
      clients,
      accessTypes,
      tickets,
      moderationData,
      botStats,
      logs,
      ticketTypes,
      maintenanceMode,
      discordClient,
      addLog,
      saveData,
      sendLog
    })
  } catch (error) {
    console.error("Erreur lors du traitement de l'interaction:", error)
    addLog("error", `Erreur d'interaction: ${error.message}`)
    
    try {
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({
          content: "❌ Une erreur est survenue lors du traitement de votre commande.",
        })
      } else if (!interaction.replied) {
        await interaction.reply({
          content: "❌ Une erreur est survenue lors du traitement de votre commande.",
          ephemeral: true,
        })
      }
    } catch (followUpError) {
      console.error("Erreur lors de la réponse d'erreur:", followUpError)
    }
  }
})

// Gestionnaire pour les messages directs (DM)
discordClient.on("messageCreate", async (message) => {
  // Ignorer les messages des bots
  if (message.author.bot) return

  // Traiter seulement les DMs
  if (message.channel.type !== ChannelType.DM) return

  // Vérifier si le message contient des attachments
  if (message.attachments.size > 0) {
    const userId = message.author.id
    const file = message.attachments.first()
    const fileExtension = path.extname(file.name).toLowerCase()
    
    if (!CONFIG.allowedExtensions.includes(fileExtension)) {
      return message.reply(`❌ Extension de fichier non supportée. Extensions autorisées: ${CONFIG.allowedExtensions.join(", ")}`)
    }
    
    if (file.size > CONFIG.maxFileSize) {
      return message.reply(`❌ Le fichier est trop volumineux. Taille maximum: ${CONFIG.maxFileSize / (1024 * 1024)}MB`)
    }
    
    const canUse = canUseService(userId, clients, accessTypes)
    if (!canUse.canUse) {
      return message.reply(`❌ ${canUse.reason}. Contactez un administrateur pour obtenir l'accès.`)
    }
    
    await message.reply("🔄 Téléchargement et traitement du fichier en cours...")
    
    try {
      const { obfuscateFileWithPrometheus } = require('./commandes.js')
      const result = await obfuscateFileWithPrometheus(file, CONFIG, userId, clients, botStats, addLog, saveData)
      
      if (result.success) {
        await message.reply({
          content: "✅ Obfuscation terminée avec succès!",
          files: [result.file]
        })
      } else {
        await message.reply(`❌ ${result.error}`)
      }
    } catch (error) {
      console.error("Erreur obfuscation DM:", error)
      addLog("error", `DM obfuscation error: ${error.message}`, userId)
      await message.reply("❌ Une erreur est survenue lors de l'obfuscation du fichier.")
    }
  }
})

// Fonction utilitaire pour vérifier l'accès
function canUseService(userId, clients, accessTypes) {
  const client = clients.get(userId)
  if (!client || !client.accessType) {
    return { canUse: false, reason: "Aucun accès configuré" }
  }

  if (client.expiryDate && new Date() > new Date(client.expiryDate)) {
    return { canUse: false, reason: "Accès expiré" }
  }

  const currentMonth = new Date().toISOString().substr(0, 7)
  if (client.lastResetDate !== currentMonth) {
    client.filesUsedThisMonth = 0
    client.lastResetDate = currentMonth
  }

  const accessType = accessTypes.get(client.accessType)
  if (accessType && accessType.filesPerMonth !== -1 && client.filesUsedThisMonth >= accessType.filesPerMonth) {
    return { canUse: false, reason: "Limite mensuelle atteinte" }
  }

  return { canUse: true }
}

// Démarrage du bot
async function startBot() {
  try {
    if (!CONFIG.botToken) {
      console.error("❌ Token du bot manquant. Veuillez définir la variable d'environnement BOT_TOKEN.")
      process.exit(1)
    }

    console.log("🔄 Chargement des données...")
    await loadData()

    console.log("🔄 Connexion au bot Discord...")
    await discordClient.login(CONFIG.botToken)

    console.log("✅ Bot FSProtect démarré avec succès!")
    addLog("info", "Bot started successfully")

    // Sauvegarder les données périodiquement
    setInterval(async () => {
      try {
        await saveData()
        console.log("💾 Données sauvegardées automatiquement")
      } catch (error) {
        console.error("Erreur sauvegarde automatique:", error)
      }
    }, 300000) // Toutes les 5 minutes

  } catch (error) {
    console.error("❌ Erreur de connexion:", error)
    addLog("error", `Erreur de connexion: ${error.message}`)
    process.exit(1)
  }
}

// Arrêt propre du bot
process.on('SIGINT', async () => {
  console.log('\n🔄 Arrêt du bot en cours...')
  try {
    await saveData()
    console.log('💾 Données sauvegardées')
    discordClient.destroy()
    console.log('✅ Bot arrêté proprement')
    process.exit(0)
  } catch (error) {
    console.error('❌ Erreur lors de l\'arrêt:', error)
    process.exit(1)
  }
})

// Gestion d'une seule catégorie de ticket
async function getOrCreateTicketCategory(guild) {
  let category = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildCategory && ch.name === "🎫 TICKETS"
  )
  if (!category) {
    category = await guild.channels.create({
      name: "🎫 TICKETS",
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: CONFIG.adminRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        { id: CONFIG.supportRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      ],
    })
  }
  CONFIG.ticketCategoryId = category.id
  return category
}

// Transcript automatique à la fermeture d'un ticket
async function saveTicketTranscript(ticketId, messages) {
  const transcriptPath = path.join(__dirname, "data", "transcripts", `${ticketId}.txt`)
  const transcriptContent = messages.map(m => `[${m.author.tag}] ${m.content}`).join("\n")
  await fs.writeFile(transcriptPath, transcriptContent)
  addLog("tickets", t("transcript_saved"))
}

// Message d'accès lors de l'ajout du bot dans un serveur
discordClient.on("guildCreate", async (guild) => {
  try {
    const channel = guild.systemChannel || guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && ch.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages))
    if (channel) {
      // Récupérer le nombre de fichiers et le nom de l'offre
      let offre = "aucune"; let nbFichiers = "0";
      const ownerId = guild.ownerId || guild.ownerID;
      if (clients.has(ownerId)) {
        const client = clients.get(ownerId)
        offre = client.accessType || "aucune"
        nbFichiers = client.filesUsedThisMonth || "0"
      }
      await channel.send({ content: `@everyone ${t("access_granted", "fr")}\nOffre: **${offre}** / Nombre de fichiers: **${nbFichiers}**` })
    }
    addLog("access", `Bot ajouté au serveur ${guild.name}`)
  } catch (err) {
    addLog("error", `Erreur lors de l'envoi du message d'accès: ${err.message}`)
  }
})

module.exports = {
  CONFIG,
  clients,
  accessTypes,
  tickets,
  moderationData,
  botStats,
  logs,
  ticketTypes,
  maintenanceMode,
  discordClient,
  addLog,
  saveData,
  sendLog,
  getOrCreateTicketCategory,
  saveTicketTranscript
}

// Démarrer le bot
startBot()