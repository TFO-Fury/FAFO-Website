import { getDb } from './firebase-admin.js';

export async function syncDiscord(userId: string, plan: string) {
  const firestore = await getDb();
  const userDoc = await firestore.collection('users').doc(userId).get();
  if (!userDoc.exists) return;

  const userData = userDoc.data();
  const discordId = userData?.discordId;
  if (!discordId) return;

  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!botToken || !guildId) return;

  let roleId: string | null = null;
  if (plan === 'aio') roleId = process.env.DISCORD_ROLE_AIO || null;
  else if (plan === 'single') roleId = process.env.DISCORD_ROLE_ONE_CLASS || null;
  else if (plan === 'trial') roleId = process.env.DISCORD_ROLE_TRIAL || '1501005403641876480';

  if (roleId) {
    try {
      await fetch(`https://discord.com/api/guilds/${guildId}/members/${discordId}/roles/${roleId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json'
        },
      });
      console.log(`[Sync] Assigned role ${roleId} to Discord user ${discordId}`);
    } catch (err) {
      console.error(`[Sync] Failed to assign role:`, err);
    }
  }
}
