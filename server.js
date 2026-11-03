const express=require("express"),{Pool}=require("pg"),crypto=require("crypto"),path=require("path");
const {DATABASE_URL,ADMIN_PASSWORD,ANTHROPIC_API_KEY}=process.env;
if(!DATABASE_URL||!ADMIN_PASSWORD){console.error("Set DATABASE_URL and ADMIN_PASSWORD.");process.exit(1)}
const SECRET=process.env.SESSION_SECRET||crypto.createHash("sha256").update("s:"+ADMIN_PASSWORD).digest("hex");
const MODEL=process.env.CLAUDE_MODEL||"claude-sonnet-5-5";
const PROMPT="You are a school library cataloguing assistant. Look at the attached photo of a book (cover, back cover or title page) and extract catalog data. Reply with ONLY a JSON object, no markdown, with string keys: title, author (comma-separated), genre (a standard library subject such as \"Filipiniana\", \"Science\" or \"Fiction\"), isbn (digits only if visible, else \"\"), dewey (best-guess Dewey Decimal number, else \"\"), publisher, year, summary (one or two neutral sentences), confidence (\"high\", \"medium\" or \"low\"). Use \"\" for anything you cannot read or reliably know. Never invent an ISBN.";
const pool=new Pool({connectionString:DATABASE_URL,ssl:process.env.PGSSL==="off"?false:{rejectUnauthorized:false}});
const app=express();app.set("trust proxy",1);app.use(express.json({limit:"8mb"}));
app.use((q,r,n)=>{r.set({"X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"same-origin"});n()});

const sha=v=>crypto.createHash("sha256").update(v).digest();
const sign=v=>crypto.createHmac("sha256",SECRET).update(v).digest("hex");
const eqs=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y)};
function isAdmin(q){const m=/(?:^|; )sid=([^;]+)/.exec(q.headers.cookie||"");if(!m)return false;const [exp,sig]=m[1].split(".");return !!sig&&Number(exp)>Date.now()&&eqs(sig,sign(exp))}
const w=f=>(q,r,n)=>f(q,r,n).catch(e=>{console.error(e);r.status(500).json({error:"Server error."})});

const tries=new Map();
app.post("/api/login",(q,r)=>{
  const t=tries.get(q.ip)||{n:0,at:Date.now()};if(Date.now()-t.at>9e5){t.n=0;t.at=Date.now()}
  if(t.n>=10)return r.status(429).json({error:"Too many attempts. Try again in 15 minutes."});
  if(!crypto.timingSafeEqual(sha(String(q.body.password||"")),sha(ADMIN_PASSWORD))){t.n++;tries.set(q.ip,t);return r.status(401).json({error:"Incorrect password."})}
  tries.delete(q.ip);const exp=String(Date.now()+12*36e5);
  r.setHeader("Set-Cookie",`sid=${exp}.${sign(exp)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${q.secure?"; Secure":""}`);r.json({ok:true})});
app.post("/api/logout",(q,r)=>{r.setHeader("Set-Cookie","sid=; HttpOnly; Path=/; Max-Age=0");r.json({ok:true})});
app.get("/api/me",(q,r)=>r.json({admin:isAdmin(q)}));

app.post("/api/scan",w(async(q,r)=>{
  if(!isAdmin(q))return r.status(403).json({error:"Admin only."});
  if(!ANTHROPIC_API_KEY)return r.status(501).json({error:"Scanning isn’t set up yet. Add ANTHROPIC_API_KEY on the server."});
  const img=String(q.body.image||"");if(!img||img.length>7e6)return r.status(400).json({error:"Bad image."});
  const a=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"content-type":"application/json","x-api-key":ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
    body:JSON.stringify({model:MODEL,max_tokens:700,messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:"image/jpeg",data:img}},{type:"text",text:PROMPT}]}]})});
  const j=await a.json();if(!a.ok){console.error(j);return r.status(502).json({error:"The scanner service returned an error."})}
  r.json({text:(j.content||[]).map(c=>c.text||"").join("")})}));

/* books are public to read; loans (student names) are admin-only */
const COLS={books:true,loans:false};
const guard=(q,r,n)=>{
  if(!(q.params.c in COLS))return r.sendStatus(404);
  if(!isAdmin(q)&&(q.method!=="GET"||!COLS[q.params.c]))return r.status(q.method==="GET"?401:403).json({error:"Admin only."});
  if(q.params.id&&!/^\d+$/.test(q.params.id))return r.sendStatus(400);
  if((q.method==="POST"||q.method==="PATCH")&&!(q.body&&typeof q.body==="object"&&!Array.isArray(q.body)&&JSON.stringify(q.body).length<20000))return r.status(400).json({error:"Bad data."});
  n()};
app.get("/api/:c",guard,w(async(q,r)=>r.json((await pool.query(`SELECT id,data FROM ${q.params.c} ORDER BY id`)).rows)));
app.post("/api/:c",guard,w(async(q,r)=>r.json((await pool.query(`INSERT INTO ${q.params.c}(data) VALUES($1) RETURNING id`,[q.body])).rows[0])));
app.patch("/api/:c/:id",guard,w(async(q,r)=>{await pool.query(`UPDATE ${q.params.c} SET data=data||$2 WHERE id=$1`,[q.params.id,q.body]);r.json({ok:true})}));
app.delete("/api/:c/:id",guard,w(async(q,r)=>{await pool.query(`DELETE FROM ${q.params.c} WHERE id=$1`,[q.params.id]);r.json({ok:true})}));

app.use(express.static(path.join(__dirname,"public")));
(async()=>{
  for(const t of Object.keys(COLS))await pool.query(`CREATE TABLE IF NOT EXISTS ${t}(id SERIAL PRIMARY KEY,data JSONB NOT NULL DEFAULT '{}')`);
  app.listen(process.env.PORT||3000,()=>console.log("Library server running"));
})().catch(e=>{console.error(e);process.exit(1)});
