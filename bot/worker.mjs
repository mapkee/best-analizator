const APP_URL = 'https://mapkee.github.io/one-step-ahead/';
const DEVELOPER_URL = 'https://t.me/mapkee';
export const HELP_TEXT = 'Как пользоваться\n\n1. Открой анализатор и выбери свою сторону.\n2. Записывай ходы: нажми на шашку, затем на клетку назначения.\n3. После хода соперника подсказка появится автоматически.\n4. Синяя стрелка показывает маршрут хода. Подсказка уточняется во время поиска.\n5. Быстрый режим — около секунды, глубокий — около 4,5 секунды.\n\nПозицию нужно переносить вручную. Для исправления хода есть «Отменить».';
export function keyboard() {
  return {inline_keyboard:[
    [{text:'Открыть приложение',web_app:{url:APP_URL}}],
    [{text:'Как пользоваться',callback_data:'help'}],
    [{text:'Написать разработчику',url:DEVELOPER_URL}],
    [{text:'GitHub',url:'https://github.com/mapkee/one-step-ahead'}]
  ]};
}
class TelegramError extends Error {
  constructor(method,detail){super(`${method}: ${detail}`);}
}
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeDetail(value,env){
  let text=String(value);
  for(const secret of [env.BOT_TOKEN,env.BOT_TOKEN?.trim(),env.WEBHOOK_SECRET])if(secret)text=text.split(secret).join('[скрыто]');
  return text.replace(/\d+:[A-Za-z0-9_-]+/g,'[скрыто]').slice(0,300);
}
async function api(env,method,payload,fetcher=fetch) {
  // Do not log request URLs or exceptions: the URL contains the bot token.
  let response;
  try {
    response=await fetcher(`https://api.telegram.org/bot${env.BOT_TOKEN.trim()}/${method}`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
    });
  } catch {throw new TelegramError(method,'Не удалось соединиться с Telegram.');}
  let result;
  try {result=await response.json()}catch{throw new TelegramError(method,`HTTP ${response.status}: ответ Telegram не в формате JSON.`)}
  if(!response.ok||!result?.ok){
    const code=result?.error_code||response.status;
    const hint=code===401?'Токен отклонён: проверь BOT_TOKEN в Production.':code===404?'Проверь формат BOT_TOKEN: нужен только токен из BotFather, без ссылки и префикса bot.':safeDetail(result?.description||'Запрос отклонён.',env);
    throw new TelegramError(method,`HTTP ${response.status}, код ${code}. ${hint}`);
  }
    return result.result;
}
export async function handleUpdate(update,env,fetcher=fetch) {
  const call=(method,payload)=>api(env,method,payload,fetcher);
  const query=update.callback_query;
  if(query){
    await call('answerCallbackQuery',{callback_query_id:query.id});
    if(query.data==='help'&&query.message?.chat?.type==='private')
      await call('sendMessage',{chat_id:query.message.chat.id,text:HELP_TEXT,reply_markup:keyboard()});
    return;
  }
  const message=update.message;
  if(message?.chat?.type!=='private'||typeof message.text!=='string')return;
  const command=message.text.trim().split(/\s+/)[0].toLowerCase();
  const help=/^\/help(?:@shashkamovebot)?$/.test(command);
  const start=/^\/start(?:@shashkamovebot)?$/.test(command);
  if(!help&&!start)return;
  await call('sendMessage',{
    chat_id:message.chat.id,
    text:help?HELP_TEXT:'На шаг впереди\n\nБудь на ход дальше. Выбери свою сторону, записывай ходы и разбирай продолжения на интерактивной доске.\n\nОткрой приложение, посмотри инструкцию или напиши разработчику.',
    reply_markup:keyboard()
  });
}
const page=(body,status=200)=>new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Настройка бота</title><style>body{font:16px system-ui;background:#080e1b;color:#eaf3ff;max-width:520px;margin:60px auto;padding:20px;line-height:1.6}input,button{box-sizing:border-box;width:100%;padding:14px;margin:10px 0;border-radius:10px;border:1px solid #345273;background:#14243a;color:white}button{background:#2454c6;cursor:pointer}</style>${body}</html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'referrer-policy':'no-referrer'}});
export async function handleRequest(request,env,fetcher=fetch) {
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/')return new Response('One Step Ahead bot worker',{headers:{'content-type':'text/plain; charset=utf-8'}});
  if(url.pathname==='/setup'&&request.method==='GET')return page('<h1>Подключение @shashkamovebot</h1><p>Введи WEBHOOK_SECRET из секретов Worker. Токен бота сюда вводить не нужно.</p><form method="post"><label>Код настройки<input type="password" name="secret" required autocomplete="off"></label><button>Подключить бота</button></form><small>Диагностика · версия 2</small>');
  if(!env.BOT_TOKEN||!env.WEBHOOK_SECRET||!/^[A-Za-z0-9_-]{32,256}$/.test(env.WEBHOOK_SECRET))return new Response('Worker secrets are not configured',{status:503});
  if(url.pathname==='/setup'&&request.method==='POST'){
    let form;try{form=await request.formData()}catch{return new Response('Bad request',{status:400})}
    if(form.get('secret')!==env.WEBHOOK_SECRET)return new Response('Forbidden',{status:403});
    try{
      const bot=await api(env,'getMe',{},fetcher);
      if(bot.username?.toLowerCase()!=='shashkamovebot')return page('<p>Токен принадлежит другому боту. Настройка отменена.</p>',400);
      const current=await api(env,'getWebhookInfo',{},fetcher);
      const target=url.origin+'/webhook';
      if(current.url&&current.url!==target)return page('<p>У бота уже есть другой webhook. Он не изменён. Сначала проверь существующий обработчик.</p>',409);
      await api(env,'setMyCommands',{commands:[{command:'start',description:'Открыть меню'},{command:'help',description:'Как пользоваться'}]},fetcher);
      await api(env,'setChatMenuButton',{menu_button:{type:'web_app',text:'Анализатор',web_app:{url:APP_URL}}},fetcher);
      await api(env,'setWebhook',{url:target,secret_token:env.WEBHOOK_SECRET,allowed_updates:['message','callback_query']},fetcher);
      return page('<h1>Бот подключён</h1><p>Открой @shashkamovebot и отправь /start. В ответ появятся четыре кнопки.</p>');
    }catch(error){
      const detail=error instanceof TelegramError?error.message:'Не удалось завершить настройку.';
      return page(`<h1>Настройка остановлена</h1><p>${escapeHtml(detail)}</p><p>Можно прислать текст этой ошибки разработчику. Токен и секрет в ответе скрыты.</p><a href="/setup">Повторить настройку</a>`,502);
    }
  }
  if(url.pathname!=='/webhook')return new Response('Not found',{status:404});
  if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers:{allow:'POST'}});
  if(request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.WEBHOOK_SECRET)return new Response('Forbidden',{status:403});
  let update;try{update=await request.json()}catch{return new Response('Bad JSON',{status:400})}
  if(!update||typeof update!=='object')return new Response('Bad update',{status:400});
  try{await handleUpdate(update,env,fetcher);return new Response('OK')}catch{return new Response('Telegram request failed',{status:502})}
}
// Cloudflare passes ExecutionContext as the third argument, not a fetch function.
// Keep the injectable fetcher inside handleRequest for tests only.
export default {
  fetch(request,env){return handleRequest(request,env);}
};
