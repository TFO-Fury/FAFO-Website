import type { VercelRequest, VercelResponse } from '@vercel/node';

// TEMPORARY diagnostic route — confirms the Discord bot token, guild ID, and
// configured role IDs are all valid by making read-only calls to Discord's
// API. Does not touch any guild member or role assignment. Remove after use.
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  const roleAio = process.env.DISCORD_ROLE_AIO;
  const roleOneClass = process.env.DISCORD_ROLE_ONE_CLASS;
  const roleTrial = process.env.DISCORD_ROLE_TRIAL || '1501005403641876480';

  const result: any = {
    envPresent: {
      DISCORD_BOT_TOKEN: !!botToken,
      DISCORD_GUILD_ID: !!guildId,
      DISCORD_ROLE_AIO: !!roleAio,
      DISCORD_ROLE_ONE_CLASS: !!roleOneClass,
      DISCORD_ROLE_TRIAL: !!roleTrial
    }
  };

  if (!botToken) {
    result.error = 'DISCORD_BOT_TOKEN missing';
    return res.status(200).json(result);
  }

  try {
    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bot ${botToken}` }
    });
    result.botTokenValid = meRes.ok;
    if (meRes.ok) {
      const me = await meRes.json();
      result.botUsername = me.username;
    } else {
      result.botTokenError = `${meRes.status} ${await meRes.text()}`;
    }
  } catch (err: any) {
    result.botTokenError = err.message;
  }

  if (guildId && botToken) {
    try {
      const guildRes = await fetch(`https://discord.com/api/guilds/${guildId}`, {
        headers: { Authorization: `Bot ${botToken}` }
      });
      result.botInGuild = guildRes.ok;
      if (guildRes.ok) {
        const guild = await guildRes.json();
        result.guildName = guild.name;
      } else {
        result.guildError = `${guildRes.status} ${await guildRes.text()}`;
      }

      const rolesRes = await fetch(`https://discord.com/api/guilds/${guildId}/roles`, {
        headers: { Authorization: `Bot ${botToken}` }
      });
      if (rolesRes.ok) {
        const roles: any[] = await rolesRes.json();
        const roleIds = new Set(roles.map(r => r.id));
        result.roleChecks = {
          aio: roleAio ? { configuredId: roleAio, existsInGuild: roleIds.has(roleAio) } : { configuredId: null },
          oneClass: roleOneClass ? { configuredId: roleOneClass, existsInGuild: roleIds.has(roleOneClass) } : { configuredId: null },
          trial: roleTrial ? { configuredId: roleTrial, existsInGuild: roleIds.has(roleTrial) } : { configuredId: null }
        };
      } else {
        result.rolesFetchError = `${rolesRes.status} ${await rolesRes.text()}`;
      }
    } catch (err: any) {
      result.guildError = err.message;
    }
  }

  return res.status(200).json(result);
}
