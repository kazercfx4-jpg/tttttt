const {
  EmbedBuilder,
  ChannelType,
  PermissionsBitField,
} = require("discord.js")

// Fonctions d'automodération
function containsLinks(content) {
  const linkRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|discord\.gg\/[^\s]+)/gi
  return linkRegex.test(content)
}

function containsExcessivePings(message) {
  const mentions = message.mentions.users.size + message.mentions.roles.size
  return mentions > 5 || message.content.includes("@everyone") || message.content.includes("@here")
}

function isSuspiciousBot(member) {
  if (!member.user.bot) return false

  const joinedRecently = Date.now() - member.joinedTimestamp < 300000 // 5 minutes
  const hasNoRoles = member.roles.cache.size <= 1 // Seulement @everyone

  return joinedRecently && hasNoRoles
}

// Système de détection anti-raid
const joinTracker = new Map() // guildId -> array of join timestamps

// Gestionnaires d'événements pour le bot
function setupEventHandlers(discordClient, { CONFIG, moderationData, addLog, sendLog }) {

  // Gestionnaire de messages pour l'automodération
  discordClient.on("messageCreate", async (message) => {
    try {
      // Ignorer les bots et les messages système
      if (message.author.bot || message.system) return

      // Ignorer les messages en DM (gérés ailleurs)
      if (!message.guild) return

      // Vérifier si l'automod est activé
      if (!moderationData.automod) return

      const member = message.member
      if (!member) return

      // Fonctions utilitaires pour les permissions
      const isAdmin = (member) => {
        return member.roles.cache.has(CONFIG.adminRoleId) || member.permissions.has(PermissionsBitField.Flags.Administrator)
      }

      const isModerator = (member) => {
        return member.permissions.has(PermissionsBitField.Flags.ModerateMembers) || isAdmin(member)
      }

      // Bypass pour les modérateurs et admins
      if (isModerator(member) || isAdmin(member)) return

      // Vérifier la liste blanche
      if (moderationData.whitelist.has(message.author.id)) return

      // Vérifier la liste noire
      if (moderationData.blacklist.has(message.author.id)) {
        try {
          await message.delete()
          addLog("automod", `Message deleted from blacklisted user: ${message.author.username}`)
          return
        } catch (error) {
          console.error("Error deleting blacklisted user message:", error)
        }
      }

      // Anti-link
      if (moderationData.automod.antilink && containsLinks(message.content)) {
        try {
          await message.delete()
          
          const embed = new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("🔗 Lien Supprimé")
            .addFields(
              { name: "Utilisateur", value: `${message.author.username} (${message.author.id})`, inline: true },
              { name: "Canal", value: message.channel.name, inline: true },
              { name: "Contenu", value: message.content.substring(0, 100) + (message.content.length > 100 ? "..." : ""), inline: false },
            )
            .setTimestamp()

          await sendLog("antilink", embed, message.guild)
          addLog("automod", `Link removed from ${message.author.username} in ${message.channel.name}`)

          // Avertir l'utilisateur en privé
          try {
            await message.author.send("❌ Votre message contenant un lien a été supprimé. Les liens ne sont pas autorisés dans ce serveur.")
          } catch (dmError) {
            // Ignore si on ne peut pas envoyer de DM
          }
        } catch (error) {
          console.error("Error in antilink moderation:", error)
        }
        return
      }

      // Anti-ping excessif
      if (moderationData.automod.antiping && containsExcessivePings(message)) {
        try {
          await message.delete()
          
          // Muter temporairement l'utilisateur (5 minutes)
          await member.timeout(5 * 60 * 1000, "Ping excessif (automod)")
          
          const embed = new EmbedBuilder()
            .setColor("#ff9900")
            .setTitle("📢 Ping Excessif")
            .addFields(
              { name: "Utilisateur", value: `${message.author.username} (${message.author.id})`, inline: true },
              { name: "Canal", value: message.channel.name, inline: true },
              { name: "Action", value: "Message supprimé + Mute 5min", inline: true },
              { name: "Mentions", value: `${message.mentions.users.size} utilisateurs, ${message.mentions.roles.size} rôles`, inline: true },
            )
            .setTimestamp()

          await sendLog("pings", embed, message.guild)
          addLog("automod", `Excessive ping from ${message.author.username}, user muted for 5 minutes`)
        } catch (error) {
          console.error("Error in antiping moderation:", error)
        }
        return
      }

    } catch (error) {
      console.error("Error in message handler:", error)
      addLog("error", `Message handler error: ${error.message}`)
    }
  })

  // Gestionnaire d'arrivée de membres
  discordClient.on("guildMemberAdd", async (member) => {
    try {
      // Anti-bot check
      if (moderationData.automod.antibot && isSuspiciousBot(member)) {
        try {
          await member.kick("Bot suspect détecté (automod)")
          
          const embed = new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("🤖 Bot Suspect Expulsé")
            .addFields(
              { name: "Bot", value: `${member.user.username} (${member.user.id})`, inline: true },
              { name: "Raison", value: "Bot ajouté récemment sans rôles", inline: true },
              { name: "Date de création", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`, inline: true },
            )
            .setTimestamp()

          await sendLog("raids", embed, member.guild)
          addLog("automod", `Suspicious bot kicked: ${member.user.username}`)
        } catch (error) {
          console.error("Error kicking suspicious bot:", error)
        }
        return
      }

      // Anti-raid detection
      if (moderationData.automod.antiraid) {
        const guildId = member.guild.id
        const now = Date.now()
        
        // Initialiser ou nettoyer le tracker
        if (!joinTracker.has(guildId)) {
          joinTracker.set(guildId, [])
        }
        
        const joins = joinTracker.get(guildId)
        // Retirer les anciens joins (plus de 30 secondes)
        const recentJoins = joins.filter(timestamp => now - timestamp < 30000)
        recentJoins.push(now)
        joinTracker.set(guildId, recentJoins)

        // Si plus de 5 personnes rejoignent en 30 secondes
        if (recentJoins.length > 5) {
          const embed = new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("⚔️ Raid Détecté")
            .addFields(
              { name: "Serveur", value: member.guild.name, inline: true },
              { name: "Membres récents", value: `${recentJoins.length} en 30s`, inline: true },
              { name: "Dernier membre", value: `${member.user.username}`, inline: true },
            )
            .setDescription("Un raid possible a été détecté. Surveillez les nouveaux membres.")
            .setTimestamp()

          await sendLog("raids", embed, member.guild)
          addLog("security", `Possible raid detected in ${member.guild.name}: ${recentJoins.length} joins in 30s`)
        }
      }

      // Log member join
      const embed = new EmbedBuilder()
        .setColor("#00ff00")
        .setTitle("👋 Nouveau Membre")
        .addFields(
          { name: "Utilisateur", value: `${member.user.username} (${member.user.id})`, inline: true },
          { name: "Compte créé", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: "Total membres", value: member.guild.memberCount.toString(), inline: true },
        )
        .setTimestamp()
        .setThumbnail(member.user.displayAvatarURL())

      await sendLog("general", embed, member.guild)
      addLog("info", `New member joined: ${member.user.username}`)

    } catch (error) {
      console.error("Error in guildMemberAdd handler:", error)
      addLog("error", `Member add handler error: ${error.message}`)
    }
  })

  // Gestionnaire de départ de membres
  discordClient.on("guildMemberRemove", async (member) => {
    try {
      const embed = new EmbedBuilder()
        .setColor("#ff0000")
        .setTitle("👋 Membre Parti")
        .addFields(
          { name: "Utilisateur", value: `${member.user.username} (${member.user.id})`, inline: true },
          { name: "Avait rejoint", value: member.joinedAt ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "Inconnu", inline: true },
          { name: "Total membres", value: member.guild.memberCount.toString(), inline: true },
        )
        .setTimestamp()
        .setThumbnail(member.user.displayAvatarURL())

      await sendLog("general", embed, member.guild)
      addLog("info", `Member left: ${member.user.username}`)

    } catch (error) {
      console.error("Error in guildMemberRemove handler:", error)
      addLog("error", `Member remove handler error: ${error.message}`)
    }
  })

  // Gestionnaire de bannissements
  discordClient.on("guildBanAdd", async (ban) => {
    try {
      const embed = new EmbedBuilder()
        .setColor("#ff0000")
        .setTitle("🔨 Utilisateur Banni")
        .addFields(
          { name: "Utilisateur", value: `${ban.user.username} (${ban.user.id})`, inline: true },
          { name: "Raison", value: ban.reason || "Aucune raison fournie", inline: true },
        )
        .setTimestamp()
        .setThumbnail(ban.user.displayAvatarURL())

      await sendLog("moderator", embed, ban.guild)
      addLog("moderation", `User banned: ${ban.user.username}`)

    } catch (error) {
      console.error("Error in guildBanAdd handler:", error)
      addLog("error", `Ban add handler error: ${error.message}`)
    }
  })

  // Gestionnaire de débannissements
  discordClient.on("guildBanRemove", async (ban) => {
    try {
      const embed = new EmbedBuilder()
        .setColor("#00ff00")
        .setTitle("🔓 Utilisateur Débanni")
        .addFields(
          { name: "Utilisateur", value: `${ban.user.username} (${ban.user.id})`, inline: true },
        )
        .setTimestamp()
        .setThumbnail(ban.user.displayAvatarURL())

      await sendLog("moderator", embed, ban.guild)
      addLog("moderation", `User unbanned: ${ban.user.username}`)

    } catch (error) {
      console.error("Error in guildBanRemove handler:", error)
      addLog("error", `Ban remove handler error: ${error.message}`)
    }
  })

  // Gestionnaire de changements d'état vocal
  discordClient.on("voiceStateUpdate", async (oldState, newState) => {
    try {
      const member = newState.member || oldState.member
      if (!member) return

      let action = ""
      let color = "#0099ff"

      if (!oldState.channel && newState.channel) {
        action = `Rejoint ${newState.channel.name}`
        color = "#00ff00"
      } else if (oldState.channel && !newState.channel) {
        action = `Quitté ${oldState.channel.name}`
        color = "#ff0000"
      } else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
        action = `Déplacé de ${oldState.channel.name} vers ${newState.channel.name}`
        color = "#ffaa00"
      } else {
        return // Pas de changement de canal
      }

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle("🔊 Mouvement Vocal")
        .addFields(
          { name: "Utilisateur", value: `${member.user.username}`, inline: true },
          { name: "Action", value: action, inline: true },
        )
        .setTimestamp()

      await sendLog("vocals", embed, member.guild)

    } catch (error) {
      console.error("Error in voiceStateUpdate handler:", error)
      addLog("error", `Voice state update error: ${error.message}`)
    }
  })

  // Gestionnaire de changements de rôles
  discordClient.on("guildMemberUpdate", async (oldMember, newMember) => {
    try {
      // Vérifier les changements de rôles
      const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id))
      const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id))

      if (addedRoles.size > 0) {
        const roleNames = addedRoles.map(role => role.name).join(", ")
        const embed = new EmbedBuilder()
          .setColor("#00ff00")
          .setTitle("👥 Rôle(s) Ajouté(s)")
          .addFields(
            { name: "Utilisateur", value: `${newMember.user.username}`, inline: true },
            { name: "Rôle(s)", value: roleNames, inline: true },
          )
          .setTimestamp()

        await sendLog("roles", embed, newMember.guild)
      }

      if (removedRoles.size > 0) {
        const roleNames = removedRoles.map(role => role.name).join(", ")
        const embed = new EmbedBuilder()
          .setColor("#ff0000")
          .setTitle("👥 Rôle(s) Retiré(s)")
          .addFields(
            { name: "Utilisateur", value: `${newMember.user.username}`, inline: true },
            { name: "Rôle(s)", value: roleNames, inline: true },
          )
          .setTimestamp()

        await sendLog("roles", embed, newMember.guild)
      }

    } catch (error) {
      console.error("Error in guildMemberUpdate handler:", error)
      addLog("error", `Member update handler error: ${error.message}`)
    }
  })

  // Gestionnaire de suppression de messages
  discordClient.on("messageDelete", async (message) => {
    try {
      if (message.author?.bot) return
      if (!message.guild) return

      const embed = new EmbedBuilder()
        .setColor("#ff9900")
        .setTitle("🗑️ Message Supprimé")
        .addFields(
          { name: "Auteur", value: message.author ? `${message.author.username}` : "Inconnu", inline: true },
          { name: "Canal", value: message.channel.name, inline: true },
          { name: "Contenu", value: message.content ? message.content.substring(0, 1000) : "*Contenu non disponible*", inline: false },
        )
        .setTimestamp()

      await sendLog("messages", embed, message.guild)

    } catch (error) {
      console.error("Error in messageDelete handler:", error)
    }
  })

  // Gestionnaire de modification de messages
  discordClient.on("messageUpdate", async (oldMessage, newMessage) => {
    try {
      if (newMessage.author?.bot) return
      if (!newMessage.guild) return
      if (oldMessage.content === newMessage.content) return

      const embed = new EmbedBuilder()
        .setColor("#ffaa00")
        .setTitle("✏️ Message Modifié")
        .addFields(
          { name: "Auteur", value: `${newMessage.author.username}`, inline: true },
          { name: "Canal", value: newMessage.channel.name, inline: true },
          { name: "Ancien contenu", value: oldMessage.content ? oldMessage.content.substring(0, 500) : "*Contenu non disponible*", inline: false },
          { name: "Nouveau contenu", value: newMessage.content.substring(0, 500), inline: false },
        )
        .setTimestamp()

      await sendLog("messages", embed, newMessage.guild)

    } catch (error) {
      console.error("Error in messageUpdate handler:", error)
    }
  })
}

// Système de notifications
const notifications = new Map()

function createNotification(userId, title, message, type = "info") {
  if (!notifications.has(userId)) {
    notifications.set(userId, [])
  }

  const notification = {
    id: require("crypto").randomBytes(8).toString("hex"),
    title: title,
    message: message,
    type: type, // 'info', 'success', 'warning', 'error'
    read: false,
    createdAt: new Date().toISOString(),
  }

  notifications.get(userId).unshift(notification)

  // Garder seulement les 50 dernières notifications par utilisateur
  const userNotifs = notifications.get(userId)
  if (userNotifs.length > 50) {
    notifications.set(userId, userNotifs.slice(-50))
  }

  return notification
}

function getUserNotifications(userId, unreadOnly = false) {
  const userNotifs = notifications.get(userId) || []
  if (unreadOnly) {
    return userNotifs.filter((notif) => !notif.read)
  }
  return userNotifs
}

function markNotificationAsRead(userId, notificationId) {
  const userNotifs = notifications.get(userId) || []
  const notif = userNotifs.find((n) => n.id === notificationId)
  if (notif) {
    notif.read = true
    return true
  }
  return false
}

// Export des fonctions
module.exports = {
  setupEventHandlers,
  createNotification,
  getUserNotifications,
  markNotificationAsRead,
  containsLinks,
  containsExcessivePings,
  isSuspiciousBot
}