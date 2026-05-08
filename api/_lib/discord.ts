import { getDb } from './firebase-admin.js';

export async function syncDiscord(userId: string, plan: string): Promise<{ success: boolean; roleId?: string; error?: string }> {
  const firestore = await getDb();
  const userDoc = await firestore.collection('users').doc(userId).get();
  if (!userDoc.exists) return { success: false, error: 'User not found' };

  const userData = userDoc.data();
  const discordId = userData?.discordId;
  if (!discordId) return { success: false, error: 'No discordId linked' };

  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!botToken || !guildId) return { success: false, error: 'Discord bot token or guild ID missing' };

  let roleId: string | null = null;
  if (plan === 'aio') roleId = process.env.DISCORD_ROLE_AIO || null;
  else if (plan === 'single') roleId = process.env.DISCORD_ROLE_ONE_CLASS || null;
  else if (plan === 'trial') roleId = process.env.DISCORD_ROLE_TRIAL || '1501005403641876480';

  if (!roleId) return { success: false, error: 'No role configured for this plan' };

  try {
    const res = await fetch(`https://discord.com/api/guilds/${guildId}/members/${discordId}/roles/${roleId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json'
      },
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error(`[Sync] Failed to assign role ${roleId}:`, res.status, errorData);
      return { success: false, roleId, error: `Discord API error ${res.status}: ${JSON.stringify(errorData)}` };
    }
    console.log(`[Sync] Assigned role ${roleId} to Discord user ${discordId}`);
    return { success: true, roleId };
  } catch (err: any) {
    console.error(`[Sync] Failed to assign role ${roleId}:`, err);
    return { success: false, roleId, error: err.message || 'Network error' };
  }
}
