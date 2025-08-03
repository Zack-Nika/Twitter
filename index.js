// index.js
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
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

// —— CONFIG ——
const {
  BOT_TOKEN,
  COMPOSER_CHANNEL_ID,
  FEED_CHANNEL_ID,
  WEBHOOK_ID,
  WEBHOOK_TOKEN
} = process.env;

// Only allow the 🔃 reaction—others get removed
const ALLOWED_EMOJIS = ['🔃'];

// Load our dark tweet HTML template
const tplDark = fs.readFileSync(
  path.resolve(__dirname, 'tweet-template-dark.html'),
  'utf8'
);

// Format numbers: 0–999 → “123”, 1 000+ → “1.2K” or “15K”
function fmt(n) {
  return n < 1e3
    ? n.toString()
    : (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'K';
}

// Render the tweet card as an image
async function generateImage(data) {
  // interpolate our Handlebars-style placeholders
  let html = tplDark
    .replace(/{{AVATAR_URL}}/g, data.avatarUrl)
    .replace(/{{DISPLAY_NAME}}/g, data.displayName)
    .replace(/{{HANDLE}}/g, data.handle)
    .replace(/{{TEXT}}/g, data.text)
    .replace(/{{TIME}}/g, data.time)
    .replace(/{{DATE}}/g, data.date)
    .replace(/{{COMMENTS}}/g, fmt(data.comments))
    .replace(/{{RETWEETS}}/g, fmt(data.retweets))
    .replace(/{{LIKES}}/g, fmt(data.likes))
    .replace(/{{VIEWS}}/g, fmt(data.views))
    .replace(/{{SHARES}}/g, fmt(data.shares))
    .replace(/{{#if VERIFIED}}/g, data.verified ? '' : '<!--')
    .replace(/{{\/if}}/g, data.verified ? '' : '-->');

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 600, height: 400, deviceScaleFactor: 2 }
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const card = await page.$('.tweet-card');

  // keep the black rounded corners intact:
  const buffer = await card.screenshot({ omitBackground: false });
  await browser.close();
  return buffer;
}

// —— Discord Setup ——
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});
const hook = new WebhookClient({ id: WEBHOOK_ID, token: WEBHOOK_TOKEN });

client.once('ready', async () => {
  const composer = await client.channels.fetch(COMPOSER_CHANNEL_ID);
  // if not already pinned, send our “Compose” button
  if (!(await composer.messages.fetchPinned()).size) {
    const darkBtn = new ButtonBuilder()
      .setCustomId('open_dark')
      .setLabel('⚫️ Dark Tweet')
      .setStyle(ButtonStyle.Primary);

    await composer
      .send({
        content: '**Compose your tweet**',
        components: [new ActionRowBuilder().addComponents(darkBtn)]
      })
      .then(m => m.pin());
  }
});

// handle button → modal → submit flow
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

    // get current time in Casablanca
    const now = new Date();
    const time = now.toLocaleTimeString('en-GB', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Casablanca'
    });
    const date = now.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Africa/Casablanca'
    });

    // random metrics
    const comments = Math.floor(Math.random() * 500 + 50);
    const retweets = Math.floor(Math.random() * 2000 + 200);
    const likes = Math.floor(Math.random() * 8000 + 500);
    const views = Math.floor(Math.random() * 90000 + 5000);
    const shares = Math.floor(Math.random() * 500 + 30);

    // build our data payload
    const data = {
      avatarUrl: i.user.displayAvatarURL({ extension: 'png', size: 512 }),
      displayName: i.user.username.replace(/_.*/, ''), // strip after underscore
      handle: i.user.username,
      text: i.fields.getTextInputValue('tweet'),
      time,
      date,
      comments,
      retweets,
      likes,
      views,
      shares,
      verified: false // toggle if you want that blue badge
    };

    // generate & send image via webhook
    const img = await generateImage(data);
    const sent = await hook.send({ files: [img] });

    // react with 🔃 for your feed channel
    const feed = await client.channels.fetch(FEED_CHANNEL_ID);
    const full = await feed.messages.fetch(sent.id);
    for (const emo of ALLOWED_EMOJIS) await full.react(emo);

    await i.editReply({ content: '✅ Your dark-mode tweet is live!', ephemeral: true });
  }
});

client.login(BOT_TOKEN);