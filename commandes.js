const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require("discord.js")
const fs = require("fs").promises
const path = require("path")
const crypto = require("crypto")
const { spawn } = require("child_process")
const fetch = require("node-fetch")

// Système de cooldown pour éviter le spam
const cooldowns = new Map()
const COOLDOWN_TIME = 3000 // 3 secondes

// Fonctions utilitaires
function isAdmin(member, CONFIG) {
  if (!member) return false
  return member.roles.cache.has(CONFIG.adminRoleId) || member.permissions.has(PermissionFlagsBits.Administrator)
}

function isSupport(member, CONFIG) {
  if (!member) return false
  return member.roles.cache.has(CONFIG.supportRoleId) || isAdmin(member, CONFIG)
}

function isOwner(userId, CONFIG) {
  if (Array.isArray(CONFIG.ownerId)) {
    return CONFIG.ownerId.includes(userId)
  }
  return userId === CONFIG.ownerId
}

function isModerator(member) {
  if (!member) return false
  return member.permissions.has(PermissionFlagsBits.ModerateMembers) || member.permissions.has(PermissionFlagsBits.Administrator)
}

function getOrCreateClient(userId, clients) {
  if (!clients.has(userId)) {
    clients.set(userId, {
      id: userId,
      accessType: null,
      expiryDate: null,
      filesUsedThisMonth: 0,
      lastResetDate: new Date().toISOString().substr(0, 7),
      joinDate: new Date().toISOString(),
    })
  }
  return clients.get(userId)
}

function resetMonthlyFiles(client) {
  const currentMonth = new Date().toISOString().substr(0, 7)
  if (client.lastResetDate !== currentMonth) {
    client.filesUsedThisMonth = 0
    client.lastResetDate = currentMonth
  }
}

function canUseService(userId, clients, accessTypes) {
  const client = clients.get(userId)
  if (!client || !client.accessType) {
    return { canUse: false, reason: "Aucun accès configuré" }
  }

  if (client.expiryDate && new Date() > new Date(client.expiryDate)) {
    return { canUse: false, reason: "Accès expiré" }
  }

  resetMonthlyFiles(client)
  const accessType = accessTypes.get(client.accessType)
  if (accessType && accessType.filesPerMonth !== -1 && client.filesUsedThisMonth >= accessType.filesPerMonth) {
    return { canUse: false, reason: "Limite mensuelle atteinte" }
  }

  return { canUse: true }
}

function checkCooldown(userId, commandName) {
  const key = `${userId}-${commandName}`
  const now = Date.now()
  
  if (cooldowns.has(key)) {
    const expirationTime = cooldowns.get(key) + COOLDOWN_TIME
    if (now < expirationTime) {
      return Math.ceil((expirationTime - now) / 1000)
    }
  }
  
  cooldowns.set(key, now)
  return 0
}

// Définition des commandes
const commands = [
  new SlashCommandBuilder()
    .setName("addclient")
    .setDescription("Ajouter un nouveau client (Admin)")
    .addUserOption((option) => option.setName("user").setDescription("Utilisateur à ajouter").setRequired(true))
    .addStringOption((option) => 
      option.setName("type")
        .setDescription("Type d'accès")
        .setRequired(true)
        .addChoices(
          { name: 'Basic', value: 'basic' },
          { name: 'Premium', value: 'premium' },
          { name: 'Unlimited', value: 'unlimited' }
        )
    ),

  new SlashCommandBuilder()
    .setName("removeclient")
    .setDescription("Supprimer un client (Admin)")
    .addUserOption((option) => option.setName("user").setDescription("Utilisateur à supprimer").setRequired(true)),

  new SlashCommandBuilder()
    .setName("typeacces")
    .setDescription("Gérer les types d'accès (Admin)")
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("Lister les types d'accès")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Ajouter un type d'accès")
        .addStringOption((option) => option.setName("name").setDescription("Nom du type d'accès").setRequired(true))
        .addIntegerOption((option) => option.setName("limit").setDescription("Limite de fichiers par mois (-1 pour illimité)").setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName("obfusquer")
    .setDescription("Obfusquer un fichier Lua")
    .addAttachmentOption((option) => option.setName("file").setDescription("Fichier à obfusquer").setRequired(true))
    .addStringOption((option) => 
      option.setName("type")
        .setDescription("Type d'obfuscation")
        .setRequired(false)
        .addChoices(
          // { name: 'Minify', value: 'Minify (Obfuscation légère)' },
          // { name: 'Weak', value: 'Weak (Obfuscation faible)' },
          { name: 'Moyenne', value: 'Medium' },
          { name: 'Forte', value: 'Strong' }
        )
    ),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Afficher l'aide et les commandes disponibles"),

  new SlashCommandBuilder()
    .setName("check")
    .setDescription("Vérifier votre accès et vos limites"),

  new SlashCommandBuilder()
    .setName("history")
    .setDescription("Voir votre historique d'utilisation"),

  new SlashCommandBuilder()
    .setName("analytics")
    .setDescription("Voir les statistiques du bot (Admin)"),

  new SlashCommandBuilder()
    .setName("listeclient")
    .setDescription("Lister tous les clients (Admin)"),

  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Démuter un utilisateur (Admin)")
    .addUserOption((option) => option.setName("user").setDescription("Utilisateur à démuter").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Raison du démute").setRequired(false)),

  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Créer un panel de tickets (Admin)")
    .addChannelOption((option) => 
      option.setName("channel")
        .setDescription("Canal où créer le panel")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Avertir un utilisateur (Modérateur)")
    .addUserOption((option) => option.setName("user").setDescription("Utilisateur à avertir").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Raison de l'avertissement").setRequired(true)),

  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Muter un utilisateur (Modérateur)")
    .addUserOption((option) => option.setName("user").setDescription("Utilisateur à muter").setRequired(true))
    .addIntegerOption((option) => option.setName("duration").setDescription("Durée en minutes").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Raison du mute").setRequired(false)),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Expulser un utilisateur (Admin)")
    .addUserOption((option) => option.setName("user").setDescription("Utilisateur à expulser").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Raison de l'expulsion").setRequired(false)),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bannir un utilisateur (Admin)")
    .addUserOption((option) => option.setName("user").setDescription("Utilisateur à bannir").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Raison du bannissement").setRequired(false))
    .addIntegerOption((option) => option.setName("delete_messages").setDescription("Jours de messages à supprimer (0-7)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Supprimer des messages (Modérateur)")
    .addIntegerOption((option) => option.setName("amount").setDescription("Nombre de messages (1-100)").setRequired(true)),

  new SlashCommandBuilder()
    .setName("maintenance")
    .setDescription("Gérer le mode maintenance (Owner)")
    .addStringOption((option) => 
      option.setName("action")
        .setDescription("Action à effectuer")
        .setRequired(true)
        .addChoices(
          { name: 'Activer', value: 'enable' },
          { name: 'Désactiver', value: 'disable' },
          { name: 'Statut', value: 'status' }
        )
    ),
]

// Fonction d'obfuscation utilisant Prometheus via CLI
function obfuscateFileWithPrometheus(file, CONFIG, userId, clients, botStats, addLog, saveData, preset = "Strong") {
  return new Promise(async (resolve) => {
    const inputPath = path.join(CONFIG.tempDir, `input_${crypto.randomBytes(8).toString('hex')}${path.extname(file.name)}`)
    const outputPath = path.join(CONFIG.tempDir, `output_${crypto.randomBytes(8).toString('hex')}${path.extname(file.name)}`)

    try {
      const response = await fetch(file.url)
      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      await fs.writeFile(inputPath, buffer)

      // Vérifier que le CLI Prometheus existe
      try {
        await fs.access(CONFIG.prometheusPath)
      } catch (error) {
        console.error("Prometheus CLI not found:", CONFIG.prometheusPath)
        resolve({
          success: false,
          error: "CLI Prometheus non trouvé. Contactez un administrateur."
        })
        return
      }

      const fileExtension = path.extname(file.name).toLowerCase()
      
      if (fileExtension === ".lua") {
        // Utiliser Prometheus CLI avec watermark automatique
        const child = spawn("lua", [
          CONFIG.prometheusPath,
          "--preset", preset,
          "--input", inputPath,
          "--output", outputPath
        ], {
          stdio: "pipe",
          timeout: 60000, // 60 secondes de timeout
        })

        let output = ""
        let errorOutput = ""

        child.stdout.on("data", (data) => {
          output += data.toString()
        })

        child.stderr.on("data", (data) => {
          errorOutput += data.toString()
        })

        child.on("close", async (code) => {
          try {
            if (code === 0) {
              try {
                const stats = await fs.stat(outputPath)
                if (stats.size > 0) {
                  // Prometheus ajoute déjà son watermark automatiquement
                  const obfuscatedFile = new AttachmentBuilder(outputPath, { 
                    name: `obfuscated_${file.name}` 
                  })

                  const client = getOrCreateClient(userId, clients)
                  client.filesUsedThisMonth += 1
                  clients.set(userId, client)
                  botStats.totalFiles += 1
                  await saveData()

                  addLog("user", `File obfuscated with ${preset}: ${file.name}`, userId)

                  // Nettoyage des fichiers temporaires
                  setTimeout(async () => {
                    try {
                      await fs.unlink(inputPath)
                      await fs.unlink(outputPath)
                    } catch (cleanupError) {
                      console.error("Erreur nettoyage fichiers:", cleanupError)
                    }
                  }, 60000)

                  resolve({
                    success: true,
                    file: obfuscatedFile,
                    preset: preset
                  })
                } else {
                  resolve({
                    success: false,
                    error: "Le fichier obfusqué est vide. Vérifiez le contenu du fichier source."
                  })
                }
              } catch (error) {
                resolve({
                  success: false,
                  error: "Erreur lors de la création du fichier obfusqué."
                })
              }
            } else {
              console.error("Prometheus error:", errorOutput)
              resolve({
                success: false,
                error: `Erreur d'obfuscation: ${errorOutput || `Code de sortie: ${code}`}`
              })
            }
          } catch (error) {
            console.error("Error in Prometheus close handler:", error)
            resolve({
              success: false,
              error: "Erreur interne lors de l'obfuscation."
            })
          }
        })

        child.on("error", (error) => {
          console.error("Prometheus spawn error:", error)
          resolve({
            success: false,
            error: "Impossible de lancer Prometheus. Lua ou le CLI ne sont peut-être pas installés correctement."
          })
        })

        // Timeout de sécurité
        setTimeout(() => {
          if (!child.killed) {
            child.kill()
            resolve({
              success: false,
              error: "Timeout: L'obfuscation a pris trop de temps."
            })
          }
        }, 65000)

      } else {
        // Pour les fichiers non-Lua, copie simple avec watermark basique
        const content = await fs.readFile(inputPath, "utf8")
        const watermark = "--[Protected by FSProtect v1.0 | discord.gg/fsprotect]\n"
        await fs.writeFile(outputPath, watermark + content)

        const protectedFile = new AttachmentBuilder(outputPath, { name: `protected_${file.name}` })

        const client = getOrCreateClient(userId, clients)
        client.filesUsedThisMonth += 1
        clients.set(userId, client)
        botStats.totalFiles += 1
        await saveData()

        addLog("user", `File protected: ${file.name}`, userId)

        setTimeout(async () => {
          try {
            await fs.unlink(inputPath)
            await fs.unlink(outputPath)
          } catch (cleanupError) {
            console.error("Erreur nettoyage fichiers:", cleanupError)
          }
        }, 60000)

        resolve({
          success: true,
          file: protectedFile,
          preset: "None"
        })
      }

    } catch (error) {
      console.error("Error in obfuscateFileWithPrometheus:", error)
      try {
        await fs.unlink(inputPath)
        await fs.unlink(outputPath)
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      let errMsg = "Erreur lors du traitement du fichier."
      if (error && error.message) {
        errMsg = error.message.length > 2000 ? error.message.slice(0, 2000) : error.message
      }
      resolve({
        success: false,
        error: errMsg
      })
    }
  })
}

// Handlers de commandes
async function handleAddClientCommand(interaction, data) {
  const { CONFIG, clients, accessTypes, addLog, saveData, sendLog } = data

  if (!isAdmin(interaction.member, CONFIG)) {
    return interaction.editReply({
      content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
    })
  }

  const user = interaction.options.getUser("user")
  const accessType = interaction.options.getString("type")

  if (!accessTypes.has(accessType)) {
    return interaction.editReply({
      content: "❌ Type d'accès invalide. Utilisez /typeacces list pour voir les types disponibles.",
    })
  }

  const client = getOrCreateClient(user.id, clients)
  client.accessType = accessType
  client.expiryDate = null
  clients.set(user.id, client)
  
  await saveData()

  const embed = new EmbedBuilder()
    .setColor("#00ff00")
    .setTitle("✅ Client Ajouté")
    .setDescription(`${user.username} a été ajouté avec l'accès ${accessType}`)
    .addFields(
      { name: "Utilisateur", value: `${user.username} (${user.id})`, inline: true },
      { name: "Type d'accès", value: accessType, inline: true },
      { name: "Date d'ajout", value: new Date().toLocaleDateString(), inline: true },
    )
    .setTimestamp()

  await interaction.editReply({ embeds: [embed] })
  
  const logEmbed = new EmbedBuilder()
    .setColor("#00ff00")
    .setTitle("🔑 Nouveau Client Ajouté")
    .addFields(
      { name: "Client", value: `${user.username} (${user.id})`, inline: true },
      { name: "Type d'accès", value: accessType, inline: true },
      { name: "Ajouté par", value: `${interaction.user.username}`, inline: true },
    )
    .setTimestamp()

  await sendLog("access", logEmbed, interaction.guild)
  addLog("admin", `Client added: ${user.username} with access ${accessType}`, interaction.user.id)
}

async function handleRemoveClientCommand(interaction, data) {
  const { CONFIG, clients, addLog, saveData, sendLog } = data

  if (!isAdmin(interaction.member, CONFIG)) {
    return interaction.editReply({
      content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
    })
  }

  const user = interaction.options.getUser("user")

  if (!clients.has(user.id)) {
    return interaction.editReply({
      content: "❌ Cet utilisateur n'est pas un client.",
    })
  }

  const clientData = clients.get(user.id)
  clients.delete(user.id)
  await saveData()

  const embed = new EmbedBuilder()
    .setColor("#ff0000")
    .setTitle("🗑️ Client Supprimé")
    .setDescription(`${user.username} a été retiré de la liste des clients`)
    .addFields(
      { name: "Utilisateur", value: `${user.username} (${user.id})`, inline: true },
      { name: "Ancien accès", value: clientData.accessType || "Non défini", inline: true },
      { name: "Date de suppression", value: new Date().toLocaleDateString(), inline: true },
    )
    .setTimestamp()

  await interaction.editReply({ embeds: [embed] })

  const logEmbed = new EmbedBuilder()
    .setColor("#ff0000")
    .setTitle("🗑️ Client Supprimé")
    .addFields(
      { name: "Client", value: `${user.username} (${user.id})`, inline: true },
      { name: "Ancien accès", value: clientData.accessType || "Non défini", inline: true },
      { name: "Supprimé par", value: `${interaction.user.username}`, inline: true },
    )
    .setTimestamp()

  await sendLog("access", logEmbed, interaction.guild)
  addLog("admin", `Client removed: ${user.username}`, interaction.user.id)
}

async function handleTypeAccessCommand(interaction, data) {
  const { CONFIG, accessTypes, addLog, saveData } = data

  if (!isAdmin(interaction.member, CONFIG)) {
    return interaction.editReply({
      content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
    })
  }

  const subcommand = interaction.options.getSubcommand()

  if (subcommand === "list") {
    if (accessTypes.size === 0) {
      return interaction.editReply({
        content: "📭 Aucun type d'accès configuré.",
      })
    }

    const typesList = Array.from(accessTypes.entries())
      .map(([key, data]) => {
        const limit = data.filesPerMonth === -1 ? "Illimité" : `${data.filesPerMonth} fichiers/mois`
        return `**${data.name}** (${key})\n└ ${limit}\n└ ${data.description}`
      })
      .join("\n\n")

    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle("🔑 Types d'Accès Disponibles")
      .setDescription(typesList)
      .setFooter({ text: `Total: ${accessTypes.size} type(s)` })
      .setTimestamp()

    await interaction.editReply({ embeds: [embed] })
  } else if (subcommand === "add") {
    const name = interaction.options.getString("name")
    const limit = interaction.options.getInteger("limit")

    if (accessTypes.has(name.toLowerCase())) {
      return interaction.editReply({
        content: "❌ Ce type d'accès existe déjà.",
      })
    }

    accessTypes.set(name.toLowerCase(), {
      name: name,
      filesPerMonth: limit,
      description: `Accès ${name} - ${limit === -1 ? "Illimité" : `${limit} fichiers par mois`}`,
    })

    await saveData()

    const embed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("✅ Type d'Accès Ajouté")
      .addFields(
        { name: "Nom", value: name, inline: true },
        { name: "Limite", value: limit === -1 ? "Illimité" : `${limit} fichiers/mois`, inline: true },
      )
      .setTimestamp()

    await interaction.editReply({ embeds: [embed] })
    addLog("admin", `Access type added: ${name} with limit ${limit}`, interaction.user.id)
  }
}

async function handleHelpCommand(interaction, data) {
  const { CONFIG } = data
  const userId = interaction.user.id
  const isUserAdmin = isAdmin(interaction.member, CONFIG)
  const isUserModerator = isModerator(interaction.member)

  const generalCommands = [
    "• `/help` - Afficher cette aide",
    "• `/check` - Vérifier votre accès et limites", 
    "• `/history` - Voir votre historique d'utilisation",
    "• `/obfusquer` - Obfusquer un fichier Lua ou protéger .zip/.rar",
  ]

  const moderatorCommands = [
    "• `/warn` - Avertir un utilisateur",
    "• `/mute` - Muter un utilisateur",
    "• `/clear` - Supprimer des messages",
  ]

  const adminCommands = [
    "• `/addclient` - Ajouter un client",
    "• `/removeclient` - Supprimer un client",
    "• `/listeclient` - Lister tous les clients",
    "• `/typeacces` - Gérer les types d'accès",
    "• `/analytics` - Voir les statistiques",
    "• `/ticketpanel` - Créer un panel de tickets",
    "• `/kick` - Expulser un utilisateur",
    "• `/ban` - Bannir un utilisateur",
    "• `/unmute` - Démuter un utilisateur",
  ]

  const ownerCommands = [
    "• `/maintenance` - Gérer le mode maintenance",
  ]

  let description = "**📋 Commandes Générales**\n" + generalCommands.join("\n")

  if (isUserModerator) {
    description += "\n\n**🛡️ Commandes Modération**\n" + moderatorCommands.join("\n")
  }

  if (isUserAdmin) {
    description += "\n\n**⚙️ Commandes Admin**\n" + adminCommands.join("\n")
  }

  if (isOwner(userId, CONFIG)) {
    description += "\n\n**👑 Commandes Owner**\n" + ownerCommands.join("\n")
  }

  const embed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("📚 Guide des Commandes FSProtect")
    .setDescription(description)
    .addFields(
      { name: "🔗 Links", value: "[Support Server](https://discord.gg/fsprotect)", inline: false },
    )
    .setFooter({ text: "FSProtect Bot v2.0 - Powered by FSProtect" })
    .setTimestamp()

  await interaction.editReply({ embeds: [embed] })
}

async function handleCheckCommand(interaction, data) {
  const { clients, accessTypes } = data
  const userId = interaction.user.id
  const client = clients.get(userId)

  if (!client) {
    return interaction.editReply({
      content: "❌ Vous n'êtes pas enregistré comme client. Contactez un administrateur.",
    })
  }

  resetMonthlyFiles(client)
  const accessType = accessTypes.get(client.accessType)
  const canUse = canUseService(userId, clients, accessTypes)

  const embed = new EmbedBuilder()
    .setColor(canUse.canUse ? "#00ff00" : "#ff0000")
    .setTitle("🔍 Statut de votre Accès")
    .addFields(
      { name: "Type d'accès", value: accessType ? accessType.name : "Non défini", inline: true },
      { name: "Statut", value: canUse.canUse ? "✅ Actif" : "❌ " + canUse.reason, inline: true },
      { name: "Fichiers utilisés ce mois", value: `${client.filesUsedThisMonth}/${accessType?.filesPerMonth === -1 ? "∞" : accessType?.filesPerMonth || 0}`, inline: true },
      { name: "Date d'inscription", value: new Date(client.joinDate).toLocaleDateString(), inline: true },
      { name: "Expiration", value: client.expiryDate ? new Date(client.expiryDate).toLocaleDateString() : "Aucune", inline: true },
    )
    .setTimestamp()

  await interaction.editReply({ embeds: [embed] })
}

async function handleHistoryCommand(interaction, data) {
  const { logs } = data
  const userId = interaction.user.id
  const userHistory = logs.filter((log) => log.userId === userId && log.type === "user")

  if (userHistory.length === 0) {
    return interaction.editReply({
      content: "📭 Aucun historique d'utilisation trouvé.",
    })
  }

  const historyText = userHistory
    .slice(0, 10)
    .map(log => `• ${new Date(log.timestamp).toLocaleDateString()} - ${log.message}`)
    .join("\n")

  const embed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("📊 Votre Historique d'Utilisation")
    .setDescription(historyText)
    .setFooter({ text: `Affichage des ${Math.min(userHistory.length, 10)} dernières actions` })
    .setTimestamp()

  await interaction.editReply({ embeds: [embed] })
}

async function handleAnalyticsCommand(interaction, data) {
  const { CONFIG, botStats, clients, tickets, moderationData, discordClient } = data

  if (!isAdmin(interaction.member, CONFIG)) {
    return interaction.editReply({
      content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
    })
  }

  const uptime = Date.now() - botStats.startTime.getTime()
  const uptimeFormatted = Math.floor(uptime / (1000 * 60 * 60 * 24)) + "j " + 
                         Math.floor((uptime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)) + "h"

  const totalTickets = tickets.size
  const openTickets = Array.from(tickets.values()).filter(t => t.status === "open").length
  
  const embed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("📊 Statistiques du Bot")
    .addFields(
      { name: "👥 Utilisateurs Totaux", value: clients.size.toString(), inline: true },
      { name: "📁 Fichiers ce Mois", value: Array.from(clients.values()).reduce((total, client) => total + client.filesUsedThisMonth, 0).toString(), inline: true },
      { name: "⏱️ Uptime", value: uptimeFormatted, inline: true },
      { name: "🎫 Tickets Totaux", value: totalTickets.toString(), inline: true },
      { name: "🎫 Tickets Ouverts", value: openTickets.toString(), inline: true },
      { name: "🌐 Serveurs", value: discordClient.guilds.cache.size.toString(), inline: true },
      { name: "⚠️ Avertissements", value: moderationData.warnings.size.toString(), inline: true },
      { name: "🔇 Utilisateurs Mutés", value: moderationData.mutedUsers.size.toString(), inline: true },
    )
    .setFooter({ text: "Statistiques en temps réel - Powered by FSProtect" })
    .setTimestamp()

  await interaction.editReply({ embeds: [embed] })
}

async function handleObfuscateCommand(interaction, data) {
  const { CONFIG, clients, accessTypes, botStats, addLog, saveData, sendLog } = data
  const userId = interaction.user.id
  const file = interaction.options.getAttachment("file")
  const preset = interaction.options.getString("type") || "Strong"

  const canUse = canUseService(userId, clients, accessTypes)
  if (!canUse.canUse) {
    return interaction.editReply({
      content: `❌ ${canUse.reason}. Contactez un administrateur pour obtenir l'accès.`,
    })
  }

  if (file.size > CONFIG.maxFileSize) {
    return interaction.editReply({
      content: `❌ Le fichier est trop volumineux. Taille maximum: ${CONFIG.maxFileSize / (1024 * 1024)}MB`,
    })
  }

  const fileExtension = path.extname(file.name).toLowerCase()
  if (!CONFIG.allowedExtensions.includes(fileExtension)) {
    return interaction.editReply({
      content: `❌ Extension de fichier non supportée. Extensions autorisées: ${CONFIG.allowedExtensions.join(", ")}`,
    })
  }

  await interaction.editReply({
    content: `🔄 Obfuscation en cours avec le type **${preset}**...\n⏱️ Cela peut prendre jusqu'à 60 secondes.`,
  })

  try {
    const result = await obfuscateFileWithPrometheus(file, CONFIG, userId, clients, botStats, addLog, saveData, preset)
    
    if (result.success) {
      const embed = new EmbedBuilder()
        .setColor("#00ff00")
        .setTitle("✅ Obfuscation Terminée")
        .setDescription("Votre fichier a été obfusqué avec succès !")
        .addFields(
          { name: "📁 Fichier", value: file.name, inline: true },
          { name: "🔧 Obfuscation", value: result.preset, inline: true },
          { name: "📊 Taille", value: `${(file.size / 1024).toFixed(2)} KB`, inline: true },
        )
        .setFooter({ text: "FSProtect v1.0 - Powered by FSProtect" })
        .setTimestamp()

      await interaction.editReply({
        content: null,
        embeds: [embed],
        files: [result.file],
      })

      const logEmbed = new EmbedBuilder()
        .setColor("#00ff00")
        .setTitle("🔐 Fichier Obfusqué")
        .addFields(
          { name: "Utilisateur", value: `${interaction.user.username} (${userId})`, inline: true },
          { name: "Fichier", value: file.name, inline: true },
          { name: "Preset", value: preset, inline: true },
          { name: "Taille", value: `${(file.size / 1024).toFixed(2)} KB`, inline: true },
          { name: "Canal", value: interaction.guild ? interaction.guild.name : "DM", inline: true },
        )
        .setTimestamp()

      if (interaction.guild) {
        await sendLog("general", logEmbed, interaction.guild)
      }
    } else {
      await interaction.editReply({
        content: `❌ Erreur d'obfuscation: ${result.error}`,
      })
    }

  } catch (error) {
    console.error("Erreur handleObfuscateCommand:", error)
    addLog("error", `Obfuscate command error: ${error.message}`, interaction.user.id)
    await interaction.editReply({
      content: "❌ Une erreur est survenue lors de l'obfuscation du fichier.",
    })
  }
}

async function handleListClientsCommand(interaction, data) {
  const { CONFIG, clients, accessTypes } = data

  if (!isAdmin(interaction.member, CONFIG)) {
    return interaction.editReply({
      content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
    })
  }

  if (clients.size === 0) {
    return interaction.editReply({
      content: "📋 Aucun client enregistré.",
    })
  }

  const clientsPerPage = 10
  const totalPages = Math.ceil(clients.size / clientsPerPage)
  const page = 1

  const clientList = Array.from(clients.entries())
    .slice((page - 1) * clientsPerPage, page * clientsPerPage)
    .map(([userId, client]) => {
      const user = interaction.guild.members.cache.get(userId)
      const username = user ? user.user.username : "Utilisateur introuvable"
      const accessType = client.accessType || "Non défini"
      const filesUsed = client.filesUsedThisMonth || 0
      const accessTypeData = accessTypes.get(client.accessType)
      const maxFiles = accessTypeData?.filesPerMonth === -1 ? "∞" : (accessTypeData?.filesPerMonth || 0)
      
      return `• **${username}** (${userId})\n  └ Type: ${accessType} | Fichiers: ${filesUsed}/${maxFiles}`
    })
    .join("\n")

  const embed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("📋 Liste des Clients")
    .setDescription(clientList)
    .setFooter({ text: `Page ${page}/${totalPages} • Total: ${clients.size} client(s)` })
    .setTimestamp()

  await interaction.editReply({ embeds: [embed] })
}

async function handleTicketPanelCommand(interaction, data) {
  const { CONFIG, addLog } = data

  if (!isAdmin(interaction.member, CONFIG)) {
    return interaction.editReply({
      content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
    })
  }

  const channel = interaction.options.getChannel("channel")

  const embed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("🎫 Tickets")
    .setDescription("Cliquez sur un bouton ci-dessous pour créer un ticket selon votre besoin.")
    .addFields(
      { name: "🔧 Support", value: "Problèmes techniques, bugs, erreurs", inline: true },
    )
    .setFooter({ text: "Un seul ticket par utilisateur à la fois" })
    .setTimestamp()

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_technical")
      .setLabel("Support")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🔧"),
  )

  try {
    await channel.send({ embeds: [embed], components: [row] })
    await interaction.editReply({
      content: `✅ Panel de tickets créé dans ${channel}`,
    })
    addLog("admin", `Ticket panel created in ${channel.name}`, interaction.user.id)
  } catch (error) {
    console.error("Erreur création panel:", error)
    await interaction.editReply({
      content: "❌ Erreur lors de la création du panel de tickets.",
    })
  }
}

// Handlers pour les commandes de modération
async function handleWarnCommand(interaction, data) {
  const { CONFIG, moderationData, addLog, saveData, sendLog } = data

  if (!isModerator(interaction.member)) {
    return interaction.editReply({
      content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
    })
  }

  const user = interaction.options.getUser("user")
  const reason = interaction.options.getString("reason")

  try {
    if (!moderationData.warnings.has(user.id)) {
      moderationData.warnings.set(user.id, [])
    }

    const warning = {
      id: crypto.randomBytes(8).toString("hex"),
      reason: reason,
      moderatorId: interaction.user.id,
      timestamp: new Date().toISOString(),
    }

    moderationData.warnings.get(user.id).push(warning)
    await saveData()

    const logEmbed = new EmbedBuilder()
      .setColor("#ffcc00")
      .setTitle("⚠️ Utilisateur Averti")
      .addFields(
        { name: "Utilisateur", value: `${user.username} (${user.id})`, inline: true },
        { name: "Raison", value: reason, inline: true },
        { name: "Modérateur", value: `${interaction.user.username}`, inline: true },
        { name: "ID Warning", value: warning.id, inline: true },
        { name: "Date", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      )
      .setTimestamp()

    await sendLog("moderator", logEmbed, interaction.guild)
    addLog("moderator", `User warned: ${user.username} by ${interaction.user.username}`, interaction.user.id)

    await interaction.editReply({
      content: `✅ ${user.username} a été averti. Raison: ${reason}`,
    })
  } catch (error) {
    console.error("Erreur warn:", error)
    await interaction.editReply({
      content: "❌ Erreur lors de l'avertissement de l'utilisateur.",
    })
  }
}

async function handleMuteCommand(interaction, data) {
  const { addLog, sendLog } = data

  if (!isModerator(interaction.member)) {
    return interaction.editReply({
      content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
    })
  }

  const user = interaction.options.getUser("user")
  const duration = interaction.options.getInteger("duration")
  const reason = interaction.options.getString("reason") || "Aucune raison spécifiée"

  if (duration < 1 || duration > 40320) {
    return interaction.editReply({
      content: "❌ La durée doit être entre 1 minute et 40320 minutes (28 jours).",
    })
  }

  try {
    const member = await interaction.guild.members.fetch(user.id)
    const timeoutDuration = duration * 60 * 1000

    await member.timeout(timeoutDuration, reason)

    const logEmbed = new EmbedBuilder()
      .setColor("#ff9900")
      .setTitle("🔇 Utilisateur Mute")
      .addFields(
        { name: "Utilisateur", value: `${user.username} (${user.id})`, inline: true },
        { name: "Durée", value: `${duration} minutes`, inline: true },
        { name: "Raison", value: reason, inline: true },
        { name: "Modérateur", value: `${interaction.user.username}`, inline: true },
        { name: "Fin du mute", value: `<t:${Math.floor((Date.now() + timeoutDuration) / 1000)}:F>`, inline: true },
      )
      .setTimestamp()

    await sendLog("moderator", logEmbed, interaction.guild)
    addLog("moderator", `User muted: ${user.username} for ${duration} minutes by ${interaction.user.username}`, interaction.user.id)

    await interaction.editReply({
      content: `✅ ${user.username} a été mute pour ${duration} minutes. Raison: ${reason}`,
    })
  } catch (error) {
    console.error("Erreur mute:", error)
    await interaction.editReply({
      content: "❌ Erreur lors du mute de l'utilisateur.",
    })
  }
}

async function handleUnmuteCommand(interaction, data) {
  const { CONFIG, addLog, sendLog } = data

  if (!isAdmin(interaction.member, CONFIG)) {
    return interaction.editReply({
      content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
    })
  }

  const user = interaction.options.getUser("user")
  const reason = interaction.options.getString("reason") || "Aucune raison spécifiée"

  try {
    const member = await interaction.guild.members.fetch(user.id)
    await member.timeout(null, reason)

    const logEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("🔊 Utilisateur démute")
      .addFields(
        { name: "Utilisateur", value: `${user.username} (${user.id})`, inline: true },
        { name: "Raison", value: reason, inline: true },
        { name: "Modérateur", value: `${interaction.user.username}`, inline: true },
        { name: "Date", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      )
      .setTimestamp()

    await sendLog("moderator", logEmbed, interaction.guild)
    addLog("moderator", `User unmuted: ${user.username} by ${interaction.user.username}`, interaction.user.id)

    await interaction.editReply({
      content: `✅ ${user.username} a été démute. Raison: ${reason}`,
    })
  } catch (error) {
    console.error("Erreur unmute:", error)
    await interaction.editReply({
      content: "❌ Erreur lors du démute de l'utilisateur.",
    })
  }
}

async function handleKickCommand(interaction, data) {
  const { CONFIG, addLog, sendLog } = data

  if (!isAdmin(interaction.member, CONFIG)) {
    return interaction.editReply({
      content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
    })
  }

  const user = interaction.options.getUser("user")
  const reason = interaction.options.getString("reason") || "Aucune raison spécifiée"

  try {
    const member = await interaction.guild.members.fetch(user.id)
    
    if (!member.kickable) {
      return interaction.editReply({
        content: "❌ Je ne peux pas expulser cet utilisateur (permissions insuffisantes).",
      })
    }

    await member.kick(reason)

    const logEmbed = new EmbedBuilder()
      .setColor("#ffaa00")
      .setTitle("🚪 Utilisateur Expulsé")
      .addFields(
        { name: "Utilisateur", value: `${user.username} (${user.id})`, inline: true },
        { name: "Raison", value: reason, inline: true },
        { name: "Modérateur", value: `${interaction.user.username}`, inline: true },
        { name: "Date", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      )
      .setTimestamp()

    await sendLog("moderator", logEmbed, interaction.guild)
    addLog("moderator", `User kicked: ${user.username} by ${interaction.user.username}`, interaction.user.id)

    await interaction.editReply({
      content: `✅ ${user.username} a été expulsé. Raison: ${reason}`,
    })
  } catch (error) {
    console.error("Erreur kick:", error)
    await interaction.editReply({
      content: "❌ Erreur lors de l'expulsion de l'utilisateur.",
    })
  }
}

async function handleBanCommand(interaction, data) {
  const { CONFIG, addLog, sendLog } = data

  if (!isAdmin(interaction.member, CONFIG)) {
    return interaction.editReply({
      content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
    })
  }

  const user = interaction.options.getUser("user")
  const reason = interaction.options.getString("reason") || "Aucune raison spécifiée"
  const deleteMessageDays = interaction.options.getInteger("delete_messages") || 0

  if (deleteMessageDays < 0 || deleteMessageDays > 7) {
    return interaction.editReply({
      content: "❌ Le nombre de jours de messages à supprimer doit être entre 0 et 7.",
    })
  }

  try {
    const member = await interaction.guild.members.fetch(user.id).catch(() => null)
    
    if (member && !member.bannable) {
      return interaction.editReply({
        content: "❌ Je ne peux pas bannir cet utilisateur (permissions insuffisantes).",
      })
    }

    await interaction.guild.members.ban(user.id, {
      reason: reason,
      deleteMessageDays: deleteMessageDays,
    })

    const logEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("🔨 Utilisateur Banni")
      .addFields(
        { name: "Utilisateur", value: `${user.username} (${user.id})`, inline: true },
        { name: "Raison", value: reason, inline: true },
        { name: "Modérateur", value: `${interaction.user.username}`, inline: true },
        { name: "Messages supprimés", value: `${deleteMessageDays} jour(s)`, inline: true },
        { name: "Date", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      )
      .setTimestamp()

    await sendLog("moderator", logEmbed, interaction.guild)
    addLog("moderator", `User banned: ${user.username} by ${interaction.user.username}`, interaction.user.id)

    await interaction.editReply({
      content: `✅ ${user.username} a été banni. Raison: ${reason}`,
    })
  } catch (error) {
    console.error("Erreur ban:", error)
    await interaction.editReply({
      content: "❌ Erreur lors du bannissement de l'utilisateur.",
    })
  }
}

async function handleClearCommand(interaction, data) {
  const { addLog, sendLog } = data

  if (!isModerator(interaction.member)) {
    return interaction.editReply({
      content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
    })
  }

  const amount = interaction.options.getInteger("amount")

  if (amount < 1 || amount > 100) {
    return interaction.editReply({
      content: "❌ Vous devez spécifier un nombre de messages entre 1 et 100.",
    })
  }

  try {
    const messages = await interaction.channel.bulkDelete(amount, true)
    const deletedCount = messages.size

    const logEmbed = new EmbedBuilder()
      .setColor("#00ffff")
      .setTitle("🧹 Messages Supprimés")
      .addFields(
        { name: "Nombre demandé", value: amount.toString(), inline: true },
        { name: "Nombre supprimé", value: deletedCount.toString(), inline: true },
        { name: "Canal", value: interaction.channel.name, inline: true },
        { name: "Modérateur", value: `${interaction.user.username}`, inline: true },
        { name: "Date", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      )
      .setTimestamp()

    await sendLog("moderator", logEmbed, interaction.guild)
    addLog("moderator", `${deletedCount} messages cleared in ${interaction.channel.name} by ${interaction.user.username}`, interaction.user.id)

    await interaction.editReply({
      content: `✅ ${deletedCount} message(s) ont été supprimés.`,
    })
  } catch (error) {
    console.error("Erreur clear:", error)
    await interaction.editReply({
      content: "❌ Erreur lors de la suppression des messages.",
    })
  }
}

async function handleMaintenanceCommand(interaction, data) {
  const { CONFIG, addLog } = data

  if (!isOwner(interaction.user.id, CONFIG)) {
    return interaction.editReply({
      content: "❌ Seul le propriétaire du bot peut utiliser cette commande.",
    })
  }

  const action = interaction.options.getString("action")

  switch (action) {
    case "enable":
      data.maintenanceMode = true
      await interaction.editReply({
        content: "🚧 Le mode maintenance a été activé. Seuls les propriétaires peuvent utiliser le bot.",
      })
      addLog("admin", `Maintenance mode enabled by ${interaction.user.username}`, interaction.user.id)
      break

    case "disable":
      data.maintenanceMode = false
      await interaction.editReply({
        content: "✅ Le mode maintenance a été désactivé. Le bot est maintenant accessible à tous.",
      })
      addLog("admin", `Maintenance mode disabled by ${interaction.user.username}`, interaction.user.id)
      break

    case "status":
      await interaction.editReply({
        content: `⚙️ Le mode maintenance est actuellement ${data.maintenanceMode ? "🚧 **activé**" : "✅ **désactivé**"}.`,
      })
      break
  }
}

// Gestionnaire principal des interactions
async function handleInteraction(interaction, data) {
  if (interaction.replied || interaction.deferred) {
    return
  }

  const { CONFIG, maintenanceMode } = data
  const userId = interaction.user.id

  // Vérifier le mode maintenance
  if (maintenanceMode && !isOwner(userId, CONFIG)) {
    if (interaction.isCommand()) {
      await interaction.reply({
        content: "🚧 Le bot est actuellement en maintenance. Veuillez réessayer plus tard.",
        ephemeral: true
      })
    }
    return
  }

  if (interaction.isCommand()) {
    const commandName = interaction.commandName

    // Vérifier le cooldown
    const cooldownLeft = checkCooldown(userId, commandName)
    if (cooldownLeft > 0) {
      await interaction.reply({
        content: `⏱️ Vous devez attendre ${cooldownLeft} seconde(s) avant d'utiliser cette commande à nouveau.`,
        ephemeral: true
      })
      return
    }

    await interaction.deferReply({ ephemeral: true })

    // Router toutes les commandes
    switch (commandName) {
      case "addclient":
        await handleAddClientCommand(interaction, data)
        break
      case "removeclient":
        await handleRemoveClientCommand(interaction, data)
        break
      case "typeacces":
        await handleTypeAccessCommand(interaction, data)
        break
      case "help":
        await handleHelpCommand(interaction, data)
        break
      case "check":
        await handleCheckCommand(interaction, data)
        break
      case "history":
        await handleHistoryCommand(interaction, data)
        break
      case "analytics":
        await handleAnalyticsCommand(interaction, data)
        break
      case "obfusquer":
        await handleObfuscateCommand(interaction, data)
        break
      case "listeclient":
        await handleListClientsCommand(interaction, data)
        break
      case "ticketpanel":
        await handleTicketPanelCommand(interaction, data)
        break
      case "warn":
        await handleWarnCommand(interaction, data)
        break
      case "mute":
        await handleMuteCommand(interaction, data)
        break
      case "unmute":
        await handleUnmuteCommand(interaction, data)
        break
      case "kick":
        await handleKickCommand(interaction, data)
        break
      case "ban":
        await handleBanCommand(interaction, data)
        break
      case "clear":
        await handleClearCommand(interaction, data)
        break
      case "maintenance":
        await handleMaintenanceCommand(interaction, data)
        break
      default:
        await interaction.editReply({
          content: "❌ Commande non implémentée.",
        })
    }
  }

  if (interaction.isButton()) {
    await interaction.deferReply({ ephemeral: true })
    
    if (interaction.customId.startsWith("ticket_")) {
      await handleTicketButtonInteraction(interaction, data)
    } else if (interaction.customId.startsWith("close_ticket_")) {
      await handleCloseTicketButton(interaction, data)
    }
  }
}

// Gestionnaire de boutons pour les tickets
async function handleTicketButtonInteraction(interaction, data) {
  const { CONFIG, tickets, addLog, saveData, sendLog } = data
  const ticketType = interaction.customId.replace("ticket_", "")
  const userId = interaction.user.id

  // Vérifier si l'utilisateur a déjà un ticket ouvert
  const existingTicket = Array.from(tickets.values()).find(
    (ticket) => ticket.userId === userId && ticket.status === "open"
  )

  if (existingTicket) {
    return interaction.editReply({
      content: `❌ Vous avez déjà un ticket ouvert: ${existingTicket.id}`,
    })
  }

  try {
    const ticketId = `ticket-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`

    // Créer le canal de ticket
    const ticketChannel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username}-${crypto.randomBytes(2).toString('hex')}`,
      type: ChannelType.GuildText,
      parent: CONFIG.ticketCategoryId,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
        {
          id: CONFIG.supportRoleId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageMessages,
          ],
        },
      ],
    })

    const ticket = {
      id: ticketId,
      channelId: ticketChannel.id,
      userId: userId,
      type: ticketType,
      status: "open",
      createdAt: new Date().toISOString(),
      closedAt: null,
      closedBy: null,
    }

    tickets.set(ticketId, ticket)
    await saveData()

    const typeNames = {
      technical: "Support Technique",
      billing: "Support Billing",
      general: "Questions Générales",
    }

    const welcomeEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("🎫 Nouveau Ticket de Support")
      .setDescription(`Bonjour ${interaction.user.toString()}, votre ticket a été créé avec succès !`)
      .addFields(
        { name: "ID du Ticket", value: ticketId, inline: true },
        { name: "Type", value: typeNames[ticketType] || ticketType, inline: true },
        { name: "Statut", value: "Ouvert", inline: true },
      )
      .setTimestamp()
      .setFooter({ text: "FSProtect Support v2.0" })

    const closeButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`close_ticket_${ticketId}`)
        .setLabel("Fermer le Ticket")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🔒"),
    )

    await ticketChannel.send({
      content: `${interaction.user.toString()} <@&${CONFIG.supportRoleId}>`,
      embeds: [welcomeEmbed],
      components: [closeButton],
    })

    await interaction.editReply({
      content: `✅ Ticket créé avec succès!\n**ID:** ${ticketId}\n**Type:** ${typeNames[ticketType]}\n\nRendez-vous dans <#${ticketChannel.id}> pour continuer.`,
    })

    const logEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("🎫 Nouveau Ticket Créé")
      .addFields(
        { name: "ID", value: ticketId, inline: true },
        { name: "Utilisateur", value: `${interaction.user.username} (${userId})`, inline: true },
        { name: "Type", value: typeNames[ticketType], inline: true },
      )
      .setTimestamp()

    await sendLog("tickets", logEmbed, interaction.guild)
    addLog("tickets", `New ticket created: ${ticketId} by ${interaction.user.username}`, userId)

  } catch (error) {
    console.error("Erreur création ticket:", error)
    await interaction.editReply({
      content: "❌ Une erreur est survenue lors de la création du ticket.",
    })
  }
}

async function handleCloseTicketButton(interaction, data) {
  const { CONFIG, tickets, addLog, saveData } = data

  if (!isSupport(interaction.member, CONFIG)) {
    return interaction.editReply({
      content: "❌ Vous n'avez pas la permission de fermer ce ticket.",
    })
  }

  const ticketId = interaction.customId.replace("close_ticket_", "")
  const ticket = tickets.get(ticketId)

  if (!ticket || ticket.status === "closed") {
    return interaction.editReply({
      content: "❌ Ce ticket n'existe pas ou est déjà fermé.",
    })
  }

  try {
    // Marquer le ticket comme fermé
    ticket.status = "closed"
    ticket.closedAt = new Date().toISOString()
    ticket.closedBy = interaction.user.id
    tickets.set(ticketId, ticket)
    await saveData()

    // Récupérer les messages du canal pour le transcript
    const channel = interaction.guild.channels.cache.get(ticket.channelId)
    let messages = []
    if (channel) {
      try {
        const fetched = await channel.messages.fetch({ limit: 100 })
        messages = Array.from(fetched.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      } catch (err) {
        console.error("Erreur récupération messages pour transcript:", err)
      }
    }
    // Sauvegarder le transcript
    try {
      const { saveTicketTranscript } = require("./bot.js")
      await saveTicketTranscript(ticketId, messages)
    } catch (err) {
      console.error("Erreur sauvegarde transcript:", err)
    }

    await interaction.editReply({
      content: "✅ Le ticket sera fermé dans 10 secondes...",
    })

    // Supprimer le canal après un délai
    setTimeout(async () => {
      try {
        if (channel) {
          await channel.delete()
        }
      } catch (error) {
        console.error("Erreur suppression canal:", error)
      }
    }, 10000)

    addLog("tickets", `Ticket closed: ${ticketId} by ${interaction.user.username}`, interaction.user.id)

  } catch (error) {
    console.error("Erreur fermeture ticket:", error)
    await interaction.editReply({
      content: "❌ Une erreur est survenue lors de la fermeture du ticket.",
    })
  }
}

// Fonction pour enregistrer les commandes
async function registerCommands(client) {
  try {
    await client.application.commands.set(commands)
    return true
  } catch (error) {
    console.error("Erreur lors de l'enregistrement des commandes:", error)
    return false
  }
}

// Export des fonctions principales
module.exports = {
  handleInteraction,
  registerCommands,
  obfuscateFileWithPrometheus
}