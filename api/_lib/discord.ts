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

// Removes every FAFO plan role (AIO / Single Class / Trial) from a user's
// Discord account. Called when their entitlement actually expires - Discord
// has no concept of an expiring role, so this has to be an explicit removal.
// Safe to call unconditionally: removing a role a member doesn't have is a
// harmless no-op on Discord's side.
export async function revokeDiscordRoles(userId: string): Promise<{ success: boolean; removed?: string[]; error?: string }> {
  const firestore = await getDb();
  const userDoc = await firestore.collection('users').doc(userId).get();
  if (!userDoc.exists) return { success: false, error: 'User not found' };

  const userData = userDoc.data();
  const discordId = userData?.discordId;
  if (!discordId) return { success: false, error: 'No discordId linked' };

  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!botToken || !guildId) return { success: false, error: 'Discord bot token or guild ID missing' };

  const roleIds = [
    process.env.DISCORD_ROLE_AIO,
    process.env.DISCORD_ROLE_ONE_CLASS,
    process.env.DISCORD_ROLE_TRIAL || '1501005403641876480'
  ].filter((id): id is string => !!id);

  const removed: string[] = [];
  for (const roleId of roleIds) {
    try {
      const res = await fetch(`https://discord.com/api/guilds/${guildId}/members/${discordId}/roles/${roleId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bot ${botToken}` }
      });
      if (res.ok) {
        removed.push(roleId);
      } else if (res.status !== 404) {
        const errorData = await res.json().catch(() => ({}));
        console.error(`[Revoke] Failed to remove role ${roleId} from ${discordId}:`, res.status, errorData);
      }
    } catch (err: any) {
      console.error(`[Revoke] Failed to remove role ${roleId} from ${discordId}:`, err);
    }
  }

  console.log(`[Revoke] Removed roles [${removed.join(', ')}] from Discord user ${discordId} (userId=${userId})`);
  return { success: true, removed };
}
