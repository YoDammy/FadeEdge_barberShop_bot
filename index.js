const { Telegraf } = require('telegraf')
const OpenAI = require('openai')
const { google } = require('googleapis')
require('dotenv').config()

const bot = new Telegraf(process.env.BOT_TOKEN)
const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const conversations = {}

const SYSTEM_PROMPT = `You are BookBot, the AI assistant for Fade & Edge Barbershop in London.
You are friendly, professional, and concise. Your only job is to help customers book an appointment.

The services available are:
- Haircut: £15 — 30 mins
- Haircut + Beard Trim: £22 — 45 mins
- Beard Trim Only: £10 — 20 mins
- Shape Up / Line Up: £12 — 20 mins
- Kids Cut (under 12): £10 — 25 mins

Opening hours: Tuesday–Saturday, 9am–6pm.

Your goal is to collect THREE pieces of information, one at a time in natural conversation:
1. The customer's name
2. The service they want
3. Their preferred day and time
- Once you have all three, confirm the details back clearly to the customer, then on a new line add exactly this tag followed by 
JSON: [BOOKING_READY]{"name":"...","service":"...","day":"...","time":"..."}

Rules:
- When the customer first makes contact or says hello, greet them warmly and immediately show the full services menu with prices before asking for their name.
- When checking appointment times, account for service duration. 
  A customer can book up to (closing time minus service duration) e.g. a 30 min haircut can be booked as late as 5:30pm.
- Only collect one piece of information per message. Do not ask for everything at once.
- Once you have all three, confirm the details back clearly, then end your message with exactly this tag on a new line: [BOOKING_READY]
- If the customer asks anything outside of booking (e.g. directions, parking), answer briefly then steer back to booking.
- Never make up services or prices not listed above.
- If the requested time is outside opening hours, politely say so and suggest an alternative.
- Keep all responses under 60 words.`

async function saveToSheets(booking) {
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })

    const sheets = google.sheets({ version: 'v4', auth })

    await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: 'FadeBarbershop!A:E',
        valueInputOption: 'RAW',
        requestBody: {
            values: [[
                new Date().toLocaleString('en-GB'),
                booking.name,
                booking.service,
                booking.day,
                booking.time,
            ]],
        },
    })
}

bot.command('reset', (ctx) => {
    const userId = ctx.from.id
    delete conversations[userId]
    ctx.reply('Conversation reset. Say hi to start a new booking 👋')
})

bot.on('text', async (ctx) => {
    const userId = ctx.from.id
    const userMessage = ctx.message.text

    if (!conversations[userId]) conversations[userId] = []
    conversations[userId].push({ role: 'user', content: userMessage })

    const typingInterval = setInterval(() => ctx.sendChatAction('typing'), 4000)
    await ctx.sendChatAction('typing')

    try {
        const response = await ai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 500,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                ...conversations[userId],
            ],
        })

        const reply = response.choices[0].message.content
        conversations[userId].push({ role: 'assistant', content: reply })

        if (reply.includes('[BOOKING_READY]')) {
        const cleanReply = reply.split('[BOOKING_READY]')[0].trim()
        const jsonString = reply.split('[BOOKING_READY]')[1].trim()
        const booking = JSON.parse(jsonString)

        await ctx.reply(cleanReply, { parse_mode: 'Markdown' })
        await saveToSheets(booking)
    }
        
        
         else {
            await ctx.reply(reply)
        }

    } catch (error) {
        console.error('AI error:', error.message)
        await ctx.reply('Sorry, something went wrong. Please try again.')
    } finally {
        clearInterval(typingInterval)
    }
})

bot.launch()
console.log('BookBot is running...')