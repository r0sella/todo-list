import dotenv from 'dotenv';
dotenv.config({ path: './bot.env' });
import TelegramBot from 'node-telegram-bot-api';
import mysql from 'mysql2/promise';

const token = process.env.TELEGRAM_TOKEN;
if (!token) {
  console.error('ОШИБКА: TELEGRAM_TOKEN не найден в переменных окружения');
  process.exit(1);
}

const dbConfig = {
  host:     process.env.DB_HOST || 'localhost',
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'todolist'
};

const bot = new TelegramBot(token, { polling: true });

// Создание подключения к базе данных
async function createConnection() {
  try {
    return await mysql.createConnection(dbConfig);
  } catch (error) {
    console.error('Ошибка подключения к БД:', error);
    return null;
  }
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
  const welcome = `
🎯 Добро пожаловать в TODO-бот!

Доступные команды:
/tasks <token>           — Показать задачи
/add <token> <задача>    — Добавить задачу
/delete <token> <номер>  — Удалить задачу
/edit <token> <номер> <новый_текст> — Редактировать задачу
/help                    — Показать справку`;
  await bot.sendMessage(msg.chat.id, welcome);
});

// Команда /help
bot.onText(/\/help/, async (msg) => {
  const help = `
📋 Справка по командам:
/tasks <token>                   — Показать задачи
/add <token> <задача>            — Добавить задачу
/delete <token> <номер>          — Удалить задачу
/edit <token> <номер> <текст>    — Редактировать задачу`;
  await bot.sendMessage(msg.chat.id, help);
});

// Показать задачи
bot.onText(/\/tasks (.+)/, async (msg, match) => {
  const authToken = match[1].trim();
  const conn = await createConnection();
  if (!conn) {
    return bot.sendMessage(msg.chat.id, '❌ Ошибка подключения к базе данных');
  }
  try {
    const [users] = await conn.execute(
      'SELECT id, username FROM users WHERE auth_token = ?',
      [authToken]
    );
    if (users.length === 0) {
      await conn.end();
      return bot.sendMessage(msg.chat.id, '❌ Неверный токен');
    }
    const { id: userId, username } = users[0];
    const [tasks] = await conn.execute(
      'SELECT id, text FROM items WHERE user_id = ? ORDER BY id',
      [userId]
    );
    await conn.end();
    if (tasks.length === 0) {
      return bot.sendMessage(msg.chat.id, `📝 ${username}, у вас пока нет задач.`);
    }
    const list = tasks
      .map((t, i) => `${i + 1}. ${t.text}`)
      .join('\n');
    await bot.sendMessage(
      msg.chat.id,
      `📋 Задачи пользователя ${username}:\n\n${list}`
    );
  } catch (error) {
    console.error('Ошибка получения задач:', error);
    await bot.sendMessage(msg.chat.id, '❌ Ошибка при получении задач');
  }
});

// Добавить задачу
bot.onText(/\/add (.+?) (.+)/, async (msg, match) => {
  const authToken = match[1].trim();
  const taskText = match[2].trim();
  if (!taskText) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ Укажите текст задачи: /add <token> <задача>'
    );
  }
  const conn = await createConnection();
  if (!conn) {
    return bot.sendMessage(msg.chat.id, '❌ Ошибка подключения к базе данных');
  }
  try {
    const [users] = await conn.execute(
      'SELECT id, username FROM users WHERE auth_token = ?',
      [authToken]
    );
    if (users.length === 0) {
      await conn.end();
      return bot.sendMessage(msg.chat.id, '❌ Неверный токен');
    }
    const { id: userId, username } = users[0];
    await conn.execute(
      'INSERT INTO items (text, user_id) VALUES (?, ?)',
      [taskText, userId]
    );
    await conn.end();
    await bot.sendMessage(
      msg.chat.id,
      `✅ Задача добавлена для ${username}: "${taskText}"`
    );
  } catch (error) {
    console.error('Ошибка добавления задачи:', error);
    await bot.sendMessage(msg.chat.id, '❌ Ошибка при добавлении задачи');
  }
});

// Удалить задачу
bot.onText(/\/delete (.+?) (\d+)/, async (msg, match) => {
  const authToken = match[1].trim();
  const taskNumber = parseInt(match[2], 10);
  const conn = await createConnection();
  if (!conn) {
    return bot.sendMessage(msg.chat.id, '❌ Ошибка подключения к базе данных');
  }
  try {
    const [users] = await conn.execute(
      'SELECT id, username FROM users WHERE auth_token = ?',
      [authToken]
    );
    if (users.length === 0) {
      await conn.end();
      return bot.sendMessage(msg.chat.id, '❌ Неверный токен');
    }
    const { id: userId, username } = users[0];
    const [tasks] = await conn.execute(
      'SELECT id, text FROM items WHERE user_id = ? ORDER BY id',
      [userId]
    );
    if (taskNumber < 1 || taskNumber > tasks.length) {
      await conn.end();
      return bot.sendMessage(
        msg.chat.id,
        `❌ Неверный номер задачи. У вас ${tasks.length} задач(и)`
      );
    }
    const { id: taskId, text } = tasks[taskNumber - 1];
    await conn.execute(
      'DELETE FROM items WHERE id = ? AND user_id = ?',
      [taskId, userId]
    );
    await conn.end();
    await bot.sendMessage(
      msg.chat.id,
      `✅ Задача удалена: "${text}"`
    );
  } catch (error) {
    console.error('Ошибка удаления задачи:', error);
    await bot.sendMessage(msg.chat.id, '❌ Ошибка при удалении задачи');
  }
});

// Редактировать задачу
bot.onText(/\/edit (.+?) (\d+) (.+)/, async (msg, match) => {
  const authToken = match[1].trim();
  const taskNumber = parseInt(match[2], 10);
  const newText = match[3].trim();
  if (!newText) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ Укажите новый текст задачи: /edit <token> <номер> <новый_текст>'
    );
  }
  const conn = await createConnection();
  if (!conn) {
    return bot.sendMessage(msg.chat.id, '❌ Ошибка подключения к базе данных');
  }
  try {
    const [users] = await conn.execute(
      'SELECT id, username FROM users WHERE auth_token = ?',
      [authToken]
    );
    if (users.length === 0) {
      await conn.end();
      return bot.sendMessage(msg.chat.id, '❌ Неверный токен');
    }
    const { id: userId, username } = users[0];
    const [tasks] = await conn.execute(
      'SELECT id, text FROM items WHERE user_id = ? ORDER BY id',
      [userId]
    );
    if (taskNumber < 1 || taskNumber > tasks.length) {
      await conn.end();
      return bot.sendMessage(
        msg.chat.id,
        `❌ Неверный номер задачи. У вас ${tasks.length} задач(и)`
      );
    }
    const { id: taskId, text: oldText } = tasks[taskNumber - 1];
    await conn.execute(
      'UPDATE items SET text = ? WHERE id = ? AND user_id = ?',
      [newText, taskId, userId]
    );
    await conn.end();
    await bot.sendMessage(
      msg.chat.id,
      `✏️ Задача обновлена:\n\nБыло: "${oldText}"\nСтало: "${newText}"`
    );
  } catch (error) {
    console.error('Ошибка редактирования задачи:', error);
    await bot.sendMessage(msg.chat.id, '❌ Ошибка при редактировании задачи');
  }
});

// Обработка прочих сообщений
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  await bot.sendMessage(msg.chat.id, 'ℹ️ Используйте /help');
});

console.log('🤖 Telegram-бот запущен!');
