import 'dotenv/config';
import fs from 'fs';
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
const BOT_TOKEN           = process.env.BOT_TOKEN;
const COMPOSER_CHANNEL_ID = process.env.COMPOSER_CHANNEL_ID;
const FEED_CHANNEL_ID     = process.env.FEED_CHANNEL_ID;
const WEBHOOK_ID          = process.env.WEBHOOK_ID;
const WEBHOOK_TOKEN       = process.env.WEBHOOK_TOKEN;

// Only allow the 🔃 reaction—others get removed
const ALLOWED_EMOJIS = ['🔃'];

// Load the dark HTML template
const tplDark = fs.readFileSync('tweet-template-dark.html', 'utf8');

const client = new Client({
  intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions ],
  partials: [ Partials.Message, Partials.Channel, Partials.Reaction ]
});
const hook = new WebhookClient({ id: WEBHOOK_ID, token: WEBHOOK_TOKEN });

// Format numbers: 0–999 → “123”, 1 000+ → “1.2K” or “15K”
function fmt(n) {
  return n < 1e3
    ? n.toString()
    : (n/1e3).toFixed(n < 1e4 ? 1 : 0) + 'K';
}

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
    .replace(/{{SHARES}}/g,       fmt(data.shares));

  const browser = await puppeteer.launch({
    args: ['--no-sandbox','--disable-setuid-sandbox'],
    defaultViewport: { width: 1500, height: 1500, deviceScaleFactor: 3 }
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const card = await page.$('.tweet-card');
  const buffer = await card.screenshot({ omitBackground: true });
  await browser.close();
  return buffer;
}

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

client.on('interactionCreate', async interaction => {
  if (interaction.isButton() && interaction.customId === 'open_dark') {
    const modal = new ModalBuilder()
      .setCustomId('tweet_dark')
      .setTitle('📝 Write Dark Tweet');
    const input = new TextInputBuilder()
      .setCustomId('tweet')
      .setLabel("What's on your mind?")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'tweet_dark') {
    await interaction.deferReply({ ephemeral: true });

    const now = new Date();
    const time = now.toLocaleTimeString('en-GB', {
      hour12: false, hour: '2-digit', minute: '2-digit',
      timeZone: 'Africa/Casablanca'
    });
    const date = now.toLocaleDateString('en-GB', {
      day:'2-digit', month:'2-digit', year:'numeric',
      timeZone:'Africa/Casablanca'
    });

    // Generate some realistic random stats
    const comments = Math.floor(Math.random() * 500 + 20);
    const retweets = Math.floor(Math.random() * 2000 + 100);
    const likes    = Math.floor(Math.random() * 8000 + 300);
    const views    = Math.floor(Math.random() * 90000 + 5000);
    const shares   = Math.floor(Math.random() * 500 + 10);

    const data = {
      avatarUrl:   interaction.user.displayAvatarURL({ extension: 'png', size: 512 }),
      displayName: interaction.user.username.replace(/_.*/,'').replace(/^./, s=>s.toUpperCase()),
      handle:      interaction.user.username,
      text:        interaction.fields.getTextInputValue('tweet'),
      time, date,
      comments, retweets, likes, views, shares
    };

    const img  = await generateImage(data);
    const sent = await hook.send({ files: [img] });
    const feed = await client.channels.fetch(FEED_CHANNEL_ID);
    const full = await feed.messages.fetch(sent.id);
    for (const emo of ALLOWED_EMOJIS) await full.react(emo);

    await interaction.editReply({ content: '✅ Your dark-mode tweet is live!', ephemeral: true });
  }
});

client.login(BOT_TOKEN);