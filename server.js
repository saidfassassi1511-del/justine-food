const express = require('express');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changez-moi';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'; // ex: https://justinefood.com

// Connexion MySQL (valeurs par défaut de XAMPP : utilisateur root, sans mot de passe)
const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'justine_food',
};

// Connexion sécurisée (SSL) : requise par Aiven et la plupart des bases en ligne.
//  - DB_SSL=true  → active le SSL
//  - DB_CA        → (recommandé) contenu du certificat "CA" fourni par Aiven, pour vérifier le serveur
// Sans DB_SSL, la connexion reste non chiffrée (cas de XAMPP en local).
if (String(process.env.DB_SSL).toLowerCase() === 'true' || process.env.DB_CA) {
  DB.ssl = process.env.DB_CA
    ? { ca: process.env.DB_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true }
    : { rejectUnauthorized: false };
}

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- Base de données (MySQL / XAMPP) ----------
let pool;
async function initDb() {
  try {
    const boot = await mysql.createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password, ssl: DB.ssl });
    await boot.query(`CREATE DATABASE IF NOT EXISTS \`${DB.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await boot.end();
  } catch (e) {
    // Sur un hébergeur (Aiven…), la base existe déjà et la création peut être refusée : on continue.
    if (!/denied|access|permission/i.test(e.message)) throw e;
    console.warn('Création de la base ignorée (droits insuffisants) :', e.message);
  }
  pool = mysql.createPool({ ...DB, waitForConnections: true, connectionLimit: 10, charset: 'utf8mb4' });
  await pool.query(`CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(16) PRIMARY KEY, created_at DATETIME NOT NULL, status VARCHAR(30) NOT NULL,
    name VARCHAR(300) NOT NULL, phone VARCHAR(30), address VARCHAR(300), note VARCHAR(500),
    payment VARCHAR(50), total INT NOT NULL, INDEX (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY, order_id VARCHAR(16) NOT NULL,
    name VARCHAR(100) NOT NULL, qty INT NOT NULL, price INT NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS reservations (
    id VARCHAR(16) PRIMARY KEY, created_at DATETIME NOT NULL, status VARCHAR(30) NOT NULL,
    name VARCHAR(300) NOT NULL, phone VARCHAR(30), guests VARCHAR(50),
    datetime VARCHAR(40) NOT NULL, note VARCHAR(500), INDEX (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

const clean = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const newId = () => crypto.randomBytes(4).toString('hex');
const ah = fn => (req, res, next) => fn(req, res, next).catch(e => {
  console.error(e); res.status(500).json({ error: 'Erreur base de données' });
});
const toOrder = (r, items) => ({ id: r.id, createdAt: r.created_at, status: r.status, name: r.name,
  phone: r.phone, address: r.address, note: r.note, payment: r.payment, total: r.total, items: items || [] });
const toResa = r => ({ id: r.id, createdAt: r.created_at, status: r.status, name: r.name,
  phone: r.phone, guests: r.guests, datetime: r.datetime, note: r.note });

async function loadOrders(where = '', params = []) {
  const [rows] = await pool.query(`SELECT * FROM orders ${where} ORDER BY created_at DESC`, params);
  if (!rows.length) return [];
  const [items] = await pool.query('SELECT order_id, name, qty, price FROM order_items WHERE order_id IN (?) ORDER BY id', [rows.map(r => r.id)]);
  return rows.map(r => toOrder(r, items.filter(i => i.order_id === r.id).map(({ name, qty, price }) => ({ name, qty, price }))));
}

// ---------- Temps réel (SSE) ----------
const clients = new Set();
const broadcast = (type, data) =>
  clients.forEach(r => r.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));

// ---------- Authentification admin ----------
const tokens = new Set();
const auth = (req, res, next) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  if (!tokens.has(t)) return res.status(401).json({ error: 'Non autorisé' });
  next();
};
app.post('/api/login', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Mot de passe incorrect' });
  const token = crypto.randomBytes(24).toString('hex');
  tokens.add(token);
  res.json({ token });
});

// ---------- API publique (appelée par le site) ----------
app.post('/api/orders', ah(async (req, res) => {
  const b = req.body;
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 50).map(i => ({
    name: clean(i.name, 100),
    qty: Math.max(1, parseInt(i.qty) || 1),
    price: Math.max(0, Math.round(Number(i.price) || 0)),
  }));
  if (!items.length || !clean(b.name) || !clean(b.address) || !clean(b.phone))
    return res.status(400).json({ error: 'Nom, téléphone, adresse et au moins un plat sont requis.' });
  const createdAt = new Date();
  const order = {
    id: newId(), createdAt: createdAt.toISOString(), status: 'nouvelle',
    name: clean(b.name), phone: clean(b.phone, 30), address: clean(b.address),
    note: clean(b.note, 500), payment: clean(b.payment, 50),
    total: items.reduce((s, i) => s + i.qty * i.price, 0), items,
  };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT INTO orders (id,created_at,status,name,phone,address,note,payment,total) VALUES (?,?,?,?,?,?,?,?,?)',
      [order.id, createdAt, order.status, order.name, order.phone, order.address, order.note, order.payment, order.total]);
    await conn.query('INSERT INTO order_items (order_id,name,qty,price) VALUES ?', [items.map(i => [order.id, i.name, i.qty, i.price])]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  broadcast('order', order);
  res.status(201).json({ ok: true, id: order.id });
}));

app.post('/api/reservations', ah(async (req, res) => {
  const b = req.body;
  if (!clean(b.name) || !clean(b.phone) || !clean(b.datetime))
    return res.status(400).json({ error: 'Nom, téléphone et date sont requis.' });
  const createdAt = new Date();
  const r = {
    id: newId(), createdAt: createdAt.toISOString(), status: 'en_attente',
    name: clean(b.name), phone: clean(b.phone, 30), guests: clean(b.guests, 50),
    datetime: clean(b.datetime, 40), note: clean(b.note, 500),
  };
  await pool.query('INSERT INTO reservations (id,created_at,status,name,phone,guests,datetime,note) VALUES (?,?,?,?,?,?,?,?)',
    [r.id, createdAt, r.status, r.name, r.phone, r.guests, r.datetime, r.note]);
  broadcast('reservation', r);
  res.status(201).json({ ok: true, id: r.id });
}));

// Suivi de commande (public, sans données personnelles)
app.get('/api/track/:id', ah(async (req, res) => {
  const o = (await loadOrders('WHERE id=?', [clean(req.params.id, 16)]))[0];
  if (!o) return res.sendStatus(404);
  res.json({ id: o.id, status: o.status, createdAt: o.createdAt, items: o.items, total: o.total });
}));
app.get('/suivi', (req, res) => res.sendFile(path.join(__dirname, 'suivi.html')));

// ---------- API admin ----------
app.get('/api/data', auth, ah(async (req, res) => {
  const [resas] = await pool.query('SELECT * FROM reservations ORDER BY created_at DESC');
  res.json({ orders: await loadOrders(), reservations: resas.map(toResa) });
}));
app.get('/api/stream', auth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});
const TABLES = { orders: 'orders', reservations: 'reservations' };
Object.keys(TABLES).forEach(kind => {
  const table = TABLES[kind];
  app.patch(`/api/${kind}/:id`, auth, ah(async (req, res) => {
    const [r] = await pool.query(`UPDATE ${table} SET status=? WHERE id=?`, [clean(req.body.status, 30), req.params.id]);
    if (!r.affectedRows) return res.sendStatus(404);
    const item = kind === 'orders'
      ? (await loadOrders('WHERE id=?', [req.params.id]))[0]
      : toResa((await pool.query('SELECT * FROM reservations WHERE id=?', [req.params.id]))[0][0]);
    broadcast('update', { kind, item }); res.json(item);
  }));
  app.delete(`/api/${kind}/:id`, auth, ah(async (req, res) => {
    await pool.query(`DELETE FROM ${table} WHERE id=?`, [req.params.id]); // les plats sont supprimés en cascade
    broadcast('refresh', {}); res.sendStatus(204);
  }));
});

// Le site est servi par le même serveur : http://localhost:3000
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'food.html')));
app.get('/script.js', (req, res) => res.sendFile(path.join(__dirname, 'script.js')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.use('/admin', express.static(path.join(__dirname, 'public')));

initDb()
  .then(() => app.listen(PORT, () => console.log(`Site : http://localhost:${PORT}  |  Dashboard : http://localhost:${PORT}/admin  |  Base MySQL : ${DB.database}`)))
  .catch(e => {
    console.error('Connexion MySQL impossible :', e.message);
    console.error('→ En local : démarrez "MySQL" dans XAMPP. En ligne : vérifiez DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME et DB_SSL=true.');
    process.exit(1);
  });