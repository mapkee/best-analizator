import assert from 'node:assert/strict';
import worker,{handleRequest,handleUpdate,keyboard,HELP_TEXT} from '../bot/worker.mjs';
const env={BOT_TOKEN:'test-only-token',WEBHOOK_SECRET:'test-only-secret-abcdefghijklmnopqrstuvwxyz'};
const calls=[];
let existingWebhook='',botUsername='shashkamovebot';
const mockFetch=async(url,options)=>{
  const method=url.split('/').at(-1),payload=JSON.parse(options.body);
  calls.push({method,payload});
  const result=method==='getMe'?{username:botUsername}:method==='getWebhookInfo'?{url:existingWebhook}:true;
  return Response.json({ok:true,result});
};
const webhook=(data,secret=env.WEBHOOK_SECRET)=>new Request('https://test.workers.dev/webhook',{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':secret},body:JSON.stringify(data)});
const start={message:{chat:{id:12,type:'private'},text:'/start'}};
assert.equal((await handleRequest(webhook(start,'wrong'),env,mockFetch)).status,403);
assert.equal(calls.length,0);
assert.equal((await handleRequest(webhook(start),{},mockFetch)).status,503);
assert.equal((await handleRequest(webhook(start),env,mockFetch)).status,200);
assert.equal(calls[0].method,'sendAnimation');
assert.equal(calls[0].payload.animation,'https://mapkee.github.io/onestep/docs/demos/six-capture.mp4');
assert.equal(calls[0].payload.chat_id,12);
assert.deepEqual(calls[0].payload.reply_markup,keyboard());
assert.equal(keyboard().inline_keyboard.length,4);
assert.deepEqual(keyboard().inline_keyboard.at(-1),[{text:'OneStep на GitHub',url:'https://github.com/mapkee/onestep'}]);
assert.equal(keyboard().inline_keyboard[0][0].web_app.url,'https://mapkee.github.io/onestep/');
assert.equal(keyboard().inline_keyboard[2][0].url,'https://t.me/mapkee');
calls.length=0;
await handleUpdate({message:{chat:{id:99,type:'group'},text:'/start'}},env,mockFetch);
assert.equal(calls.length,0);
await handleUpdate({message:{chat:{id:12,type:'private'},text:'/help@shashkamovebot'}},env,mockFetch);
assert.equal(calls[0].payload.text,HELP_TEXT);
calls.length=0;
await handleUpdate({callback_query:{id:'q1',data:'help',message:{chat:{id:12,type:'private'}}}},env,mockFetch);
assert.deepEqual(calls.map(call=>call.method),['answerCallbackQuery','sendMessage']);
assert.equal(calls[1].payload.text,HELP_TEXT);
const setup=secret=>new Request('https://test.workers.dev/setup',{method:'POST',body:new URLSearchParams({secret})});
calls.length=0;
assert.equal((await handleRequest(setup('wrong'),env,mockFetch)).status,403);
assert.equal(calls.length,0);
botUsername='anotherbot';
assert.equal((await handleRequest(setup(env.WEBHOOK_SECRET),env,mockFetch)).status,400);
botUsername='shashkamovebot';existingWebhook='https://existing.example/webhook';calls.length=0;
assert.equal((await handleRequest(setup(env.WEBHOOK_SECRET),env,mockFetch)).status,409);
assert.ok(!calls.some(call=>call.method==='setWebhook'));
existingWebhook='';calls.length=0;
assert.equal((await handleRequest(setup(env.WEBHOOK_SECRET),env,mockFetch)).status,200);
assert.deepEqual(calls.map(call=>call.method),['getMe','getWebhookInfo','setMyName','setMyShortDescription','setMyDescription','setMyCommands','setChatMenuButton','setWebhook']);
assert.equal(calls.find(call=>call.method==='setMyName').payload.name,'OneStep');
assert.equal(calls.find(call=>call.method==='setChatMenuButton').payload.menu_button.web_app.url,'https://mapkee.github.io/onestep/');
assert.equal(calls.at(-1).payload.url,'https://test.workers.dev/webhook');
assert.equal(calls.at(-1).payload.secret_token,env.WEBHOOK_SECRET);
const failed=await handleRequest(webhook(start),env,async()=>{throw Error('sensitive-token-url')});
assert.equal(failed.status,502);
assert.ok(!(await failed.text()).includes('sensitive-token-url'));
for(const [code,description,expected] of [[401,'Unauthorized','BOT_TOKEN'],[400,`Bad Request: <bad> ${env.BOT_TOKEN} ${env.WEBHOOK_SECRET}`,'&lt;bad&gt;']]){
  const response=await handleRequest(setup(env.WEBHOOK_SECRET),env,async()=>Response.json({ok:false,error_code:code,description},{status:code}));
  const body=await response.text();
  assert.equal(response.status,502);
  assert.ok(body.includes('getMe:'));
  assert.ok(body.includes(expected));
  assert.ok(!body.includes(env.BOT_TOKEN));
  assert.ok(!body.includes(env.WEBHOOK_SECRET));
}
const laterFailure=await handleRequest(setup(env.WEBHOOK_SECRET),env,async(url,options)=>url.endsWith('/setWebhook')?Response.json({ok:false,error_code:400,description:'Bad webhook: Failed to resolve host'},{status:400}):mockFetch(url,options));
assert.match(await laterFailure.text(),/setWebhook:.*Failed to resolve host/);
// Exercise the actual Workers entry point, including its third runtime argument.
const originalFetch=globalThis.fetch;
globalThis.fetch=mockFetch;
try{
  calls.length=0;
  const executionContext={waitUntil(){},passThroughOnException(){}};
  const configured=await worker.fetch(setup(env.WEBHOOK_SECRET),env,executionContext);
  assert.equal(configured.status,200);
  assert.match(await configured.text(),/Бот подключён/);
  assert.ok(calls.some(call=>call.method==='getMe'));
  assert.ok(calls.some(call=>call.method==='setWebhook'));
  calls.length=0;
  assert.equal((await worker.fetch(webhook(start),env,executionContext)).status,200);
  assert.equal(calls[0].method,'sendAnimation');
}finally{globalThis.fetch=originalFetch;}
console.log('Bot tests passed. No real Telegram messages sent.');
calls.length=0;
await handleUpdate(start,env,async(url,options)=>{
  if(url.endsWith('/sendAnimation')){calls.push({method:'sendAnimation'});return Response.json({ok:false,error_code:400,description:'Media unavailable'},{status:400});}
  return mockFetch(url,options);
});
assert.deepEqual(calls.map(call=>call.method),['sendAnimation','sendMessage']);
assert.deepEqual(calls[1].payload.reply_markup,keyboard());
