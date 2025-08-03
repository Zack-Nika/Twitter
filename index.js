// index.js
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  WebhookClient
} from 'discord.js';

// — fix ESM __dirname —
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// —— CONFIG ——
// Make sure these are defined in your .env or Railway environment
const BOT_TOKEN             = process.env.BOT_TOKEN;
const COMPOSER_CHANNEL_ID   = process.env.COMPOSER_CHANNEL_ID;
const FEED_CHANNEL_ID       = process.env.FEED_CHANNEL_ID;
const WEBHOOK_ID            = process.env.WEBHOOK_ID;
const WEBHOOK_TOKEN         = process.env.WEBHOOK_TOKEN;

// Only allow the 🔃 reaction—others get removed
const ALLOWED_EMOJIS = ['🔃'];

// Load the dark HTML template
const tplDark = fs.readFileSync(
  path.resolve(__dirname, 'tweet-template-dark.html'),
  'utf8'
);

// Format numbers: 0–999 → “123”, 1 000+ → “1.2K” or “15K”
function fmt(n) {
  return n < 1e3
    ? n.toString()
    : (n/1e3).toFixed(n < 1e4 ? 1 : 0) + 'K';
}

// Render the image via Puppeteer
async function generateImage(data) {
  const html = tplDark
    .replace(/{{AVATAR_URL}}/g,   data.avatarUrl)
    .replace(/{{DISPLAY_NAME}}/g, data.displayName)
    .replace(/{{HANDLE}}/g,       data.handle)
    .replace(/{{TEXT}}/g,         data.text)
    .replace(/{{TIME}}/g,         data.time)
    .replace(/{{DATE}}/g,         data.date)
    .replace(/{{COMMENTS}}/g,     fmt(data.comments))
    .replace(/{{RETWEETS}}/g,     fmt(data.retweets))
    .replace(/{{LIKES}}/g,        fmt(data.likes))
    .replace(/{{VIEWS}}/g,        fmt(data.views))
    .replace(/{{SHARES}}/g,       fmt(data.shares))
    .replace(/{{BADGE}}/g,        data.verified
      ? `<img src="path/to/verified-badge.svg" class="badge" />`
      : '');

  const browser = await puppeteer.launch({
    args: ['--no-sandbox','--disable-setuid-sandbox'],
    defaultViewport: { width: 1600, height: 1400, deviceScaleFactor: 3 }
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const card = await page.$('.tweet-card');
  const buffer = await card.screenshot({ omitBackground: true });
  await browser.close();
  return buffer;
}

// Discord client + webhook
const client = new Client({
  intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions ],
  partials: [ Partials.Message, Partials.Channel, Partials.Reaction ]
});
const hook = new WebhookClient({ id: WEBHOOK_ID, token: WEBHOOK_TOKEN });

client.once('ready', async () => {
  const composer = await client.channels.fetch(COMPOSER_CHANNEL_ID);
  if (!(await composer.messages.fetchPinned()).size) {
    const darkBtn = new ButtonBuilder()
      .setCustomId('open_dark')
      .setLabel('⚫️ Dark Tweet')
      .setStyle(ButtonStyle.Primary);

    await composer.send({
      content: '**Compose your tweet**',
      components: [ new ActionRowBuilder().addComponents(darkBtn) ]
    }).then(m => m.pin());
  }
});

client.on('interactionCreate', async i => {
  if (i.isButton() && i.customId === 'open_dark') {
    const modal = new ModalBuilder()
      .setCustomId('tweet_dark')
      .setTitle('📝 Write Dark Tweet');
    const input = new TextInputBuilder()
      .setCustomId('tweet')
      .setLabel("What's on your mind?")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return i.showModal(modal);
  }

  if (i.isModalSubmit() && i.customId === 'tweet_dark') {
    await i.deferReply({ ephemeral: true });

    // Moroccan time & date
    const now = new Date();
    const time = now.toLocaleTimeString('en-GB', {
      hour12: false, hour: '2-digit', minute: '2-digit',
      timeZone: 'Africa/Casablanca'
    });
    const date = now.toLocaleDateString('en-GB', {
      day:'2-digit', month:'2-digit', year:'numeric',
      timeZone:'Africa/Casablanca'
    });

    // Random metrics for realism
    const comments = Math.floor(Math.random()*500 + 50);
    const retweets = Math.floor(Math.random()*2000 + 200);
    const likes    = Math.floor(Math.random()*8000 + 500);
    const views    = Math.floor(Math.random()*90000 + 5000);
    const shares   = Math.floor(Math.random()*500 + 30);

    const data = {
      avatarUrl:   i.user.displayAvatarURL({ extension:'png', size:512 }),
      displayName: i.user.username.replace(/_.*/, ''),  // Franco from im_franco
      handle:      i.user.username,
      text:        i.fields.getTextInputValue('tweet'),
      time, date,
      comments, retweets, likes, views, shares,
      verified:    false  // or some logic to set true
    };

    const img  = await generateImage(data);
    const sent = await hook.send({ files: [img] });
    const feed = await client.channels.fetch(FEED_CHANNEL_ID);
    const full = await feed.messages.fetch(sent.id);
    for (const emo of ALLOWED_EMOJIS) await full.react(emo);

    await i.editReply({ content: '✅ Your dark-mode tweet is live!', ephemeral: true });
  }
});

client.login(BOT_TOKEN);