import dotenv from 'dotenv';
dotenv.config({ path: './bot.env' });

import TelegramBot from 'node-telegram-bot-api';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const token = process.env.TELEGRAM_TOKEN;
if (!token) {
  console.error('ОШИБКА: TELEGRAM_TOKEN не найден в переменных окружения');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Функция открытия соединения с SQLite
async function getDbConnection() {
  try {
    return open({
      filename: './todolist.sqlite',
      driver: sqlite3.Database
    });
  } catch (error) {
    console.error('Ошибка подключения к SQLite:', error);
    return null;
  }
}

// Команды /start и /help (без работы с БД)
bot.onText(/\/start/, async (msg) => {
  const welcome = `
🎯 Добро пожаловать в TODO-бот!
/tasks <токен> — Показать задачи
/add <токен> <задача> — Добавить задачу
/delete <токен> <номер> — Удалить задачу
/edit <токен> <номер> <новый_текст> — Редактировать задачу
/help — Показать справку`;
  await bot.sendMessage(msg.chat.id, welcome);
});

bot.onText(/\/help/, async (msg) => {
  const help = `
📋 Справка по командам:
/tasks <токен> — Показать задачи
/add <токен> <задача> — Добавить задачу
/delete <токен> <номер> — Удалить задачу
/edit <токен> <номер> <новый_текст> — Редактировать задачу`;
  await bot.sendMessage(msg.chat.id, help);
});

// Вывод списка задач
bot.onText(/\/tasks (.+)/, async (msg, match) => {
  const authToken = match[1].trim();
  const db = await getDbConnection();
  if (!db) {
    return bot.sendMessage(msg.chat.id, '❌ Ошибка подключения к базе данных');
  }
  try {
    const user = await db.get(
      'SELECT id, username FROM users WHERE auth_token = ?',
      authToken
    );
    if (!user) {
      return bot.sendMessage(msg.chat.id, '❌ Неверный токен');
    }
    const tasks = await db.all(
      'SELECT id, text FROM items WHERE user_id = ? ORDER BY id',
      user.id
    );
    if (tasks.length === 0) {
      return bot.sendMessage(msg.chat.id, `📝 ${user.username}, у вас пока нет задач.`);
    }
    const list = tasks.map((t, i) => `${i + 1}. ${t.text}`).join('\n');
    await bot.sendMessage(msg.chat.id, `📋 Задачи ${user.username}:\n\n${list}`);
  } catch (err) {
    console.error('Ошибка получения задач:', err);
    await bot.sendMessage(msg.chat.id, '❌ Ошибка при получении задач');
  }
});

// Добавление задачи
bot.onText(/\/add (.+?) (.+)/, async (msg, match) => {
  const authToken = match[1].trim();
  const taskText = match[2].trim();
  if (!taskText) {
    return bot.sendMessage(msg.chat.id, '❌ Укажите текст задачи: /add <токен> <задача>');
  }
  const db = await getDbConnection();
  if (!db) {
    return bot.sendMessage(msg.chat.id, '❌ Ошибка подключения к базе данных');
  }
  try {
    const user = await db.get(
      'SELECT id, username FROM users WHERE auth_token = ?',
      authToken
    );
    if (!user) {
      return bot.sendMessage(msg.chat.id, '❌ Неверный токен');
    }
    await db.run(
      'INSERT INTO items (text, user_id) VALUES (?, ?)',
      taskText, user.id
    );
    await bot.sendMessage(msg.chat.id, `✅ Задача добавлена для ${user.username}: "${taskText}"`);
  } catch (err) {
    console.error('Ошибка добавления задачи:', err);
    await bot.sendMessage(msg.chat.id, '❌ Ошибка при добавлении задачи');
  }
});

// Удаление задачи
bot.onText(/\/delete (.+?) (\d+)/, async (msg, match) => {
  const authToken = match[1].trim();
  const taskNumber = parseInt(match[2], 10);
  const db = await getDbConnection();
  if (!db) {
    return bot.sendMessage(msg.chat.id, '❌ Ошибка подключения к базе данных');
  }
  try {
    const user = await db.get(
      'SELECT id, username FROM users WHERE auth_token = ?',
      authToken
    );
    if (!user) {
      return bot.sendMessage(msg.chat.id, '❌ Неверный токен');
    }
    const tasks = await db.all(
      'SELECT id, text FROM items WHERE user_id = ? ORDER BY id',
      user.id
    );
    if (taskNumber < 1 || taskNumber > tasks.length) {
      return bot.sendMessage(msg.chat.id, `❌ Неверный номер задачи. У вас ${tasks.length} задач(и)`);
    }
    const { id: taskId, text } = tasks[taskNumber - 1];
    await db.run(
      'DELETE FROM items WHERE id = ? AND user_id = ?',
      taskId, user.id
    );
    await bot.sendMessage(msg.chat.id, `✅ Задача удалена: "${text}"`);
  } catch (err) {
    console.error('Ошибка удаления задачи:', err);
    await bot.sendMessage(msg.chat.id, '❌ Ошибка при удалении задачи');
  }
});

// Редактирование задачи
bot.onText(/\/edit (.+?) (\d+) (.+)/, async (msg, match) => {
  const authToken = match[1].trim();
  const taskNumber = parseInt(match[2], 10);
  const newText = match[3].trim();
  if (!newText) {
    return bot.sendMessage(msg.chat.id, '❌ Укажите новый текст задачи: /edit <токен> <номер> <новый_текст>');
  }
  const db = await getDbConnection();
  if (!db) {
    return bot.sendMessage(msg.chat.id, '❌ Ошибка подключения к базе данных');
  }
  try {
    const user = await db.get(
      'SELECT id, username FROM users WHERE auth_token = ?',
      authToken
    );
    if (!user) {
      return bot.sendMessage(msg.chat.id, '❌ Неверный токен');
    }
    const tasks = await db.all(
      'SELECT id, text FROM items WHERE user_id = ? ORDER BY id',
      user.id
    );
    if (taskNumber < 1 || taskNumber > tasks.length) {
      return bot.sendMessage(msg.chat.id, `❌ Неверный номер задачи. У вас ${tasks.length} задач(и)`);
    }
    const { id: taskId, text: oldText } = tasks[taskNumber - 1];
    await db.run(
      'UPDATE items SET text = ? WHERE id = ? AND user_id = ?',
      newText, taskId, user.id
    );
    await bot.sendMessage(
      msg.chat.id,
      `✏️ Задача обновлена:\n\nБыло: "${oldText}"\nСтало: "${newText}"`
    );
  } catch (err) {
    console.error('Ошибка редактирования задачи:', err);
    await bot.sendMessage(msg.chat.id, '❌ Ошибка при редактировании задачи');
  }
});

// Обработка прочих сообщений
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  await bot.sendMessage(msg.chat.id, 'ℹ️ Используйте /help');
});

console.log('🤖 Telegram-бот запущен!');
