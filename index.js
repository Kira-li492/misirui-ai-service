const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const LEADS_FILE = path.join(__dirname, 'leads.json');

if (!fs.existsSync(LEADS_FILE)) fs.writeFileSync(LEADS_FILE, '[]');

const SYSTEM_PROMPT_ZH = `你是米斯瑞家具（MISIRUI Furniture）的AI客服助手Sophia，主要服务B2B客户（批发商、设计师、酒店采购等）。
回答专业、友好、简洁，不超过120字，不使用markdown格式和加粗符号。
公司提供OEM/ODM/OBM定制服务，主要产品如下：

【酒吧家具】吧台椅/高脚凳：实木、金属、布艺、真皮、马鞍皮
【餐厅家具】餐椅：皮革、布艺、真皮、马鞍皮、实木、金属、旋转款；餐桌：实木、木皮贴面
【客厅家具】沙发：布艺、真皮、模块化、高密度海绵、实木框架；躺椅、休闲椅、茶几：实木/金属/玻璃/大理石
【酒店家具】商务休闲椅
【户外家具】冥想椅/座椅

当客户询问产品或定制时，先用一句话回答，然后问："请问您的使用场景是？"
不要问材质、尺寸、数量，这些由销售专员跟进。
永远不要说"我只是AI"或"我无法处理"，当客户提供联系方式时，直接回复"好的，已记录，专员会尽快联系您"即可。`;

const SYSTEM_PROMPT_EN = `You are Sophia, AI customer service assistant for MISIRUI Furniture, serving B2B clients (wholesalers, designers, hotel procurement, etc.).
Be professional, friendly, and concise. Keep replies under 100 words. No markdown or bold formatting.
MISIRUI offers OEM/ODM/OBM customization. Main products:

[Bar Furniture] Bar stools & counter stools: solid wood, metal, fabric, genuine leather, saddle leather
[Dining Room] Dining chairs: leather, fabric, genuine leather, saddle leather, solid wood, metal, swivel; Dining tables: solid wood, wood veneer
[Living Room] Sofas: fabric, genuine leather, modular, high-density foam, solid wood frame; Recliners, armchairs, coffee tables: wood/metal/glass/marble
[Hotel Furniture] Business lounge chairs
[Outdoor] Meditation chairs & seats

When a client asks about products or customization, answer in one sentence then ask: "What is your use case?"
Never say "I'm just an AI" or "I can't handle that." When a client provides contact info, reply: "Got it, our sales team will reach out to you shortly."`;

app.post('/chat', async (req, res) => {
  const { messages, lang } = req.body;
  const systemPrompt = lang === 'zh' ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT_EN;
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });
    res.json({ reply: response.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/save-lead', (req, res) => {
  const { name, contact, contactType, product, scene, summary, lang } = req.body;
  const leads = JSON.parse(fs.readFileSync(LEADS_FILE));
  leads.unshift({
    id: Date.now(),
    time: new Date().toLocaleString('zh-CN'),
    name, contact, contactType: contactType || '', product, scene, summary,
    lang: lang || 'zh',
    status: 'new'
  });
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  res.json({ ok: true });
});

app.post('/update-lead', (req, res) => {
  const { id, status } = req.body;
  const leads = JSON.parse(fs.readFileSync(LEADS_FILE));
  const lead = leads.find(l => l.id === id);
  if (lead) {
    lead.status = status;
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'not found' });
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/leads', (req, res) => {
  const leads = JSON.parse(fs.readFileSync(LEADS_FILE));
  res.json(leads);
});

app.post('/extract-lead', async (req, res) => {
  const { messages, lang } = req.body;
  const labelUser = lang === 'zh' ? '客户' : 'Client';
  const conversation = messages.map(m => `${m.role === 'user' ? labelUser : 'Sophia'}：${m.content}`).join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      system: 'Extract client info from the conversation. Return only JSON, no other text. Format: {"name":"","contact":"","product":"","scene":""}. Empty string if not found.',
      messages: [{ role: 'user', content: conversation }]
    });

    const raw = response.content[0].text.replace(/```json|```/g, '').trim();
    console.log('提取结果：', raw);
    const data = JSON.parse(raw);

    if (data.contact) {
      const leads = JSON.parse(fs.readFileSync(LEADS_FILE));
      const exists = leads.some(l => l.contact === data.contact);
      if (!exists) {
        leads.unshift({
          id: Date.now(),
          time: new Date().toLocaleString('zh-CN'),
          name: data.name || (lang === 'zh' ? '未知' : 'Unknown'),
          contact: data.contact,
          product: data.product,
          scene: data.scene,
          summary: conversation,
          lang: lang || 'en',
          status: 'new'
        });
        fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
        res.json({ saved: true });
      } else {
        res.json({ saved: false });
      }
    } else {
      res.json({ saved: false });
    }
  } catch (err) {
    console.log('extract error:', err.message);
    res.json({ saved: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`服务器运行在 http://localhost:${PORT}`));
