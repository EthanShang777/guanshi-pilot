import template from './payload.json';
const origin='https://ethanshang777.github.io';
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store'};
const reply=(body,status=200)=>Response.json(body,{status,headers});
async function sign(id,secret){
 const enc=new TextEncoder();
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(id))),b=>b.toString(16).padStart(2,'0')).join('');
}
export default {async fetch(req,env){
 if(req.method==='OPTIONS')return new Response(null,{headers});
 const url=new URL(req.url);
 if(url.pathname==='/health')return reply({ready:!!env.OPENAI_API_KEY});
 if(req.headers.get('Origin')!==origin)return reply({error:'来源无效'},403);
 const auth={Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'};
 try{
 if(req.method==='POST' && url.pathname==='/research'){
 if(Number(req.headers.get('Content-Length'))>2048)return reply({error:'输入过长'},400);
 const {company}=await req.json();
 if(typeof company!=='string'||!company.trim()||company.length>160)return reply({error:'请输入公司全称'},400);
 const ip=req.headers.get('CF-Connecting-IP')||'unknown';
 if(!(await env.LIMIT.limit({key:ip})).success||!(await env.GLOBAL.limit({key:'site'})).success)return reply({error:'本分钟研究请求已满，请稍后再试'},429);
 const res=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:auth,body:JSON.stringify({...template,input:JSON.stringify({company:company.trim()})})});
 if(!res.ok)return reply({error:'模型服务未受理研究（'+res.status+'）'},502);
 const {id}=await res.json();
 return reply({job:id+'.'+await sign(id,env.OPENAI_API_KEY)},202);
 }
 if(req.method==='GET' && url.pathname==='/research'){
 const [id,signature]=(url.searchParams.get('job')||'').split('.');
 if(!/^resp_[a-zA-Z0-9_-]{1,160}$/.test(id)||signature!==await sign(id,env.OPENAI_API_KEY))return reply({error:'任务无效'},400);
 const res=await fetch('https://api.openai.com/v1/responses/'+id+'?include%5B%5D=web_search_call.action.sources',{headers:auth});
 if(!res.ok)return reply({error:'读取研究失败'},502);
 const data=await res.json();
 if(['queued','in_progress'].includes(data.status))return reply({status:data.status});
 if(data.status!=='completed')return reply({error:'研究未完成，请重试'},502);
 const parts=data.output.filter(x=>x.type==='message').flatMap(x=>x.content).filter(x=>x.type==='output_text');
 const result=JSON.parse(parts.map(x=>x.text).join(''));
 return reply({status:'completed',model:data.model,result});
 }
 return reply({error:'无此接口'},404);
 }catch{return reply({error:'研究服务请求失败'},502);}
}};
