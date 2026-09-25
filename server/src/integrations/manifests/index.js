import builtin from './builtin.js';
import email from './email.js';
import slack from './slack.js';
import http from './http.js';
import database from './database.js';
import discord from './discord.js';
import teams from './teams.js';
import twilio from './twilio.js';
import github from './github.js';
import jira from './jira.js';
import linear from './linear.js';
import sheets from './sheets.js';
import notion from './notion.js';
import airtable from './airtable.js';
import stripe from './stripe.js';
import hubspot from './hubspot.js';
import webhook from './webhook.js';
import rss from './rss.js';
import knowledge from './knowledge.js';
import ai from './ai.js';
import mcp from './mcp.js';
import { withInbound } from '../inbound.js';

/**
 * The static registration list (spec/26 §1): explicit and easy to follow, no
 * directory scan. Adding an integration is one manifest file plus one line here.
 * Ordered by category, the way the gallery groups them (spec/27 §8).
 */
export const INTEGRATIONS = [
  // Communication
  slack, discord, teams, email, twilio,
  // Developer
  github, jira, linear,
  // Data & productivity
  sheets, notion, airtable, database,
  // Commerce & CRM
  stripe, hubspot,
  // Web
  http, webhook, rss,
  // AI
  ai, knowledge, mcp,
  // Built-in
  builtin,
// Integrations with triggers but no inbound adapter of their own get the
// generic one (spec/27 §5); manifests that declare `inbound` are left as-is.
].map(withInbound);
