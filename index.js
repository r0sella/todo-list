import dotenv from 'dotenv';
dotenv.config({ path: './bot.env' });
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import querystring from 'querystring';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import './bot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 4000;

// --- Настройки базы данных ---
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'todolist',
};

// --- Простое хранилище сессий в памяти ---
const sessions = {};

// --- Операции с пользователями и сессиями ---
async function registerUser(username, password) {
  const hash = await bcrypt.hash(password, 10);
  const token = crypto.randomUUID();
  const connection = await mysql.createConnection(dbConfig);
  try {
    await connection.execute(
      'INSERT INTO users (username, password_hash, auth_token) VALUES (?, ?, ?)',
      [username, hash, token]
    );
  } finally {
    await connection.end();
  }
  return token;
}

async function authenticateUser(username, password) {
  const connection = await mysql.createConnection(dbConfig);
  const [rows] = await connection.execute(
    'SELECT * FROM users WHERE username = ?',
    [username]
  );
  await connection.end();
  
  if (rows.length === 0) return null;
  
  const user = rows[0];
  
  // Проверяем, есть ли password_hash (пользователь зарегистрирован через веб)
  if (!user.password_hash) {
    // Пользователь зарегистрирован через Telegram бота - нет пароля для веб-входа
    return null;
  }
  
  const valid = await bcrypt.compare(password, user.password_hash);
  return valid ? user : null;
}

function createSession(user) {
  const sid = crypto.randomBytes(16).toString('hex');
  sessions[sid] = {
    userId: user.id,
    username: user.username,
    authToken: user.auth_token,
    created: Date.now(),
  };
  return sid;
}

function getSession(req, res) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('sid='));
  
  if (!cookie) {
    console.log('Cookie не найден');
    return null;
  }
  
  const sid = cookie.split('=')[1];
  const session = sessions[sid];
  
  if (!session) {
    console.log('Сессия не найдена для sid:', sid);
    return null;
  }
  
  // Проверка на истечение сессии (24 часа)
  const SESSION_TIMEOUT = 24 * 60 * 60 * 1000;
  if (Date.now() - session.created > SESSION_TIMEOUT) {
    console.log('Сессия истекла для sid:', sid);
    delete sessions[sid];
    return null;
  }
  
  return session;
}

// --- Операции с задачами ---
async function addListItem(text, userId) {
  const connection = await mysql.createConnection(dbConfig);
  try {
    await connection.execute(
      'INSERT INTO items (text, user_id) VALUES (?, ?)',
      [text, userId]
    );
  } finally {
    await connection.end();
  }
}

async function deleteListItem(id, userId) {
  const connection = await mysql.createConnection(dbConfig);
  try {
    await connection.execute(
      'DELETE FROM items WHERE id = ? AND user_id = ?',
      [id, userId]
    );
  } finally {
    await connection.end();
  }
}

async function editListItem(id, text, userId) {
  const connection = await mysql.createConnection(dbConfig);
  try {
    await connection.execute(
      'UPDATE items SET text = ? WHERE id = ? AND user_id = ?',
      [text, id, userId]
    );
  } finally {
    await connection.end();
  }
}

async function retrieveListItems(userId) {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const [rows] = await connection.execute(
      'SELECT id, text FROM items WHERE user_id = ?',
      [userId]
    );
    return rows;
  } finally {
    await connection.end();
  }
}

function renderTemplate(filePath, data = {}) {
  const tpl = fs.readFileSync(path.join(__dirname, filePath), 'utf-8');
  return tpl.replace(/{{\s*(\w+)\s*}}/g, (_, key) => data[key] || '');
}

async function getHtmlRows(userId) {
  const items = await retrieveListItems(userId);
  return items
    .map(
      (item, idx) =>
        `<tr>
          <td>${idx + 1}</td>
          <td>${item.text}</td>
          <td>
            <form method="POST" action="/edit" style="display: inline;">
              <input type="hidden" name="id" value="${item.id}">
              <input type="text" name="text" value="${item.text}" required>
              <button type="submit" class="btn btn-edit">Изменить</button>
            </form>
            <form method="POST" action="/delete" style="display: inline;">
              <input type="hidden" name="id" value="${item.id}">
              <button type="submit" class="btn btn-delete">Удалить</button>
            </form>
          </td>
        </tr>`
    )
    .join('');
}


// --- HTTP сервер ---
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // CORS заголовки
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  try {
    // Статические файлы
    if (url.pathname === '/') {
      const session = getSession(req, res);
      if (!session) {
        res.writeHead(302, { Location: '/login' });
        res.end();
        return;
      }
      
      const rows = await getHtmlRows(session.userId);
      const html = renderTemplate('index.html', {
        username: session.username,
        auth_token: session.authToken,
        rows: rows
      });
      
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    
    if (url.pathname === '/login' && req.method === 'GET') {
      const html = renderTemplate('login.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.url === '/logout') {
    // Удаляем сессию пользователя
    const cookieHeader = req.headers.cookie || '';
    let sid = null;
    cookieHeader.split(';').forEach(c => {
        if (c.trim().startsWith('sid=')) {
            sid = c.trim().split('=')[1];
        }
    });
    if (sid && sessions[sid]) {
        delete sessions[sid];
    }
    // Сбрасываем cookie и делаем редирект
    res.writeHead(302, {
        'Set-Cookie': 'sid=; Max-Age=0; Path=/',
        'Location': 'http://localhost:4000/login'
    });
    res.end();
    return;
    }

    
    if (url.pathname === '/register' && req.method === 'GET') {
      const html = renderTemplate('register.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    
    if (url.pathname === '/login-error' && req.method === 'GET') {
      const html = renderTemplate('login-error.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    
    // POST запросы
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', async () => {
        const data = querystring.parse(body);
        
        if (url.pathname === '/login') {
          const user = await authenticateUser(data.username, data.password);
          if (user) {
            const sid = createSession(user);
            res.writeHead(302, {
              Location: '/',
              'Set-Cookie': `sid=${sid}; HttpOnly; Path=/; Max-Age=86400`
            });
            res.end();
          } else {
            res.writeHead(302, { Location: '/login-error' });
            res.end();
          }
          return;
        }
        
        if (url.pathname === '/register') {
          try {
            await registerUser(data.username, data.password);
            res.writeHead(302, { Location: '/login' });
            res.end();
          } catch (error) {
            console.error('Ошибка регистрации:', error);
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Ошибка регистрации');
          }
          return;
        }
        
        // Остальные POST запросы требуют аутентификации
        const session = getSession(req, res);
        if (!session) {
          res.writeHead(302, { Location: '/login' });
          res.end();
          return;
        }
        
        if (url.pathname === '/add') {
          await addListItem(data.text, session.userId);
          res.writeHead(302, { Location: '/' });
          res.end();
          return;
        }
        
        if (url.pathname === '/delete') {
          await deleteListItem(data.id, session.userId);
          res.writeHead(302, { Location: '/' });
          res.end();
          return;
        }
        
        if (url.pathname === '/edit') {
          await editListItem(data.id, data.text, session.userId);
          res.writeHead(302, { Location: '/' });
          res.end();
          return;
        }
        
        if (url.pathname === '/logout') {
          const cookieHeader = req.headers.cookie || '';
          const cookie = cookieHeader
            .split(';')
            .map(c => c.trim())
            .find(c => c.startsWith('sid='));
          
          if (cookie) {
            const sid = cookie.split('=')[1];
            delete sessions[sid];
          }
          
          res.writeHead(302, {
            Location: '/login',
            'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0'
          });
          res.end();
          return;
        }
      });
      return;
    }
    
    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Страница не найдена');
    
  } catch (error) {
    console.error('Ошибка сервера:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Внутренняя ошибка сервера');
  }
});

server.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}/`);
});
