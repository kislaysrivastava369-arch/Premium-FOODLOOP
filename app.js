// Run: npm i jsdom && node tests/test.js   (tests the real app.js in a simulated browser)
const {JSDOM}=require('jsdom'),fs=require('fs'),path=require('path'),O=path.join(__dirname,'..');
const d=new JSDOM(fs.readFileSync(O+'/index.html','utf8'),{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
const w=d.window; w.matchMedia=()=>({matches:false}); w.scrollTo=()=>{}; w.alert=()=>{};
const errs=[]; w.addEventListener('error',e=>errs.push(e.message));
w.eval(fs.readFileSync(O+'/app.js','utf8'));
const F=w.FoodLoop,S=F.state;let n=0,fail=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fail++;};
const mk=(sv,win=30)=>{const l={id:'T'+(++n),title:'T',cat:'Cooked Meals',diet:'veg',servings:sv,price:5,assistPrice:0,windowEnd:Date.now()+S.off+win*6e4,org:'X',made:new Date().toISOString(),deadline:new Date(Date.now()+S.off+36e5*9).toISOString(),lat:12.97,lng:77.59,address:'a b c d e',handling:'',desc:'',phone:'9',status:'available'};S.listings.push(l);return l;};
const g=(l,who)=>S.res.find(r=>r.lid===l.id&&r.who===who);
const admin=F.login('admin@foodloop.demo','Admin@1234');
// engine: 50-meal scenario
let r=F.allocateQueue(50,0,[{n:'A',tier:3,requested:15,ts:1},{n:'B',tier:3,requested:10,ts:2},{n:'N',tier:1,requested:30,ts:5},{n:'C',tier:3,requested:10,ts:6}],'fair3');
ok(r.map(x=>x.r.n+x.a).join()==='N30,A15,B5,C0','Engine: 50-meal = NGO30, A15, B5, C0');
// identity: pending/rejected/verified NGO, impersonation
F.login('hope@hopekitchen.demo','Demo@1234');ok(F.tierOfAcc(S.acc.find(a=>a.id===S.session))===3,'Pending NGO gets NO priority');
F.login('shelter@oldtrust.demo','Demo@1234');ok(F.tierOfAcc(S.acc.find(a=>a.id===S.session))===3,'Rejected NGO gets NO priority');
ok(!F.login('ngo@annadaan.demo','wrong').ok,'Wrong password rejected');
// registration
let reg=F.register('ngo',{name:'New NGO',email:'x@new.demo',pw:'Pass@1234',pw2:'Pass@1234',contact:'C',phone:'9123456780',address:'addr',regNo:'DEMO-REG-9',cert:true});
ok(reg.ok&&reg.acc.status==='pending'&&F.tierOfAcc(reg.acc)===3,'NGO registration -> Verification Pending, no priority');
ok(!F.register('ngo',{name:'N',email:'bad',pw:'1',pw2:'2'}).ok,'Validation: bad email/password mismatch');
ok(!F.register('ngo',{name:'Dup',email:'x@new.demo',pw:'Pass@1234',pw2:'Pass@1234',contact:'C',phone:'9123456780',address:'a',regNo:'DEMO-REG-9',cert:true}).ok,'Duplicate demo account blocked');
// admin approval gate
F.login('ravi@demo.test','Demo@1234');ok(!F.review(reg.acc.id,'verified'),'Non-admin cannot approve');
F.login('admin@foodloop.demo','Admin@1234');ok(F.review(reg.acc.id,'verified')&&F.tierOfAcc(reg.acc)===1,'Admin approval enables priority');
// 50-meal flow through real app: NGO requests AFTER individuals, window open
let l=mk(50);S.session=null;
F.createRequest(l.id,'a5',15,1);F.createRequest(l.id,'a4',10,2); // Ravi general 15, Asha assist 10
F.login('ngo@annadaan.demo','Demo@1234');F.createRequest(l.id,'a1',30,5);
F.login('hope@hopekitchen.demo','Demo@1234');F.createRequest(l.id,'a2',10,6);  // pending NGO = general
ok(F.remaining(l)===50,'Nothing committed while window is open');
const early=S.res.find(x=>x.lid===l.id&&x.who.startsWith('Ravi'));
ok(F.payRes(early.id,'UPI','success').ok===false,'Cannot pay before allocation is final');
F.advanceTime(31);
const N=g(l,'Annadaan NGO (demo)'),A=g(l,'Asha (demo assistance recipient)'),R=g(l,'Ravi (demo individual)'),H=g(l,'Hope Community Kitchen (demo)');
ok(N.alloc===30&&N.amount===0&&N.rs==='confirmed'&&N.code,'Late NGO gets 30 FREE + pickup code (₹0)');
ok(A.alloc===10&&A.amount===0&&A.rs==='confirmed','Fair3: verified assistance next, free');
ok(R.alloc===10&&R.amount===50,'General individual gets remaining 10 at ₹5 = ₹50');
ok(H.alloc===0&&H.rs==='unallocated','Pending NGO (general) gets 0; no pay button state');
ok(F.payRes(H.id,'UPI','success').ok===false,'No payment for zero allocation');
ok(F.remaining(l)===0,'Total = 50, remaining 0');
// payments
let p=F.payRes(R.id,'UPI','fail',  'Google Pay');ok(!p.ok&&R.rs==='allocated','Payment failure: allocation held, no code');
for(const m of ['UPI','Card','Netbanking','Wallet']){const l2=mk(5,0);F.login('ravi@demo.test','Demo@1234');const q=F.createRequest(l2.id,'a5',2,1);const rr=q.res;const out=F.payRes(rr.id,m,'success','x');ok(out.ok&&out.amount===10&&rr.code,'Demo payment via '+m+' succeeds (₹10)');}
p=F.payRes(R.id,'Wallet','success','Demo Wallet');ok(p.ok&&R.rs==='confirmed'&&R.code,'Payment success -> confirmed + pickup code');
// refund + release
const before=F.remaining(l);F.cancelRes(R.id);
ok(R.pay==='refunded'&&F.remaining(l)===before+10&&S.pay.some(x=>x.rid===R.id&&x.status==='refunded'),'Cancel after payment: refund record + inventory released');
ok(!F.payRes(R.id,'UPI','success').ok,'No payment for cancelled reservation');
// pickup
const d0=S.done.length;ok(!F.collectRes(N.id).ok===false&&S.done.length===d0+1,'Pickup confirmed once');ok(!F.collectRes(N.id).ok,'Duplicate collection blocked');
// policy simple vs fair3
S.policy='simple';let l3=mk(30);F.login('ravi@demo.test','Demo@1234');F.createRequest(l3.id,'a5',20,1);F.createRequest(l3.id,'a4',20,3);F.advanceTime(31);
ok(g(l3,'Ravi (demo individual)').alloc===20&&g(l3,'Asha (demo assistance recipient)').alloc===10,'Simple policy: assistance tier ignored, FCFS');
S.policy='fair3';let l4=mk(30);F.createRequest(l4.id,'a5',20,1);F.createRequest(l4.id,'a4',20,3);F.advanceTime(31);
ok(g(l4,'Asha (demo assistance recipient)').alloc===20&&g(l4,'Ravi (demo individual)').alloc===10,'Fair3 policy: verified assistance before general buyer');
// late request cannot revoke committed
let l5=mk(10,0);F.login('ravi@demo.test','Demo@1234');F.createRequest(l5.id,'a5',10,1);F.login('ngo@annadaan.demo','Demo@1234');
ok(!F.createRequest(l5.id,'a1',5,2).ok,'Late NGO cannot revoke committed servings');
// expiry
let l6=mk(10);l6.deadline=new Date(Date.now()-1000).toISOString();ok(!F.createRequest(l6.id,'a5',1).ok,'Expired listing rejects requests');
ok(S.listings.every(x=>F.remaining(x)>=0),'No negative quantities');
// UI render smoke
w.location.hash='#home';['#discover','#how','#impact','#dash','#donate'].forEach(h=>{w.location.hash=h;});
w.document.querySelector('.tab[data-tab=admin]').click();w.document.querySelector('.tab[data-tab=recipient]').click();
w.location.hash='#home';
ok(!!w.document.querySelector('#roleCards .role-card'),'Home: role cards rendered');
setTimeout(()=>{ok(w.document.querySelectorAll('#flowSix li').length===6,'Six-step flow visible');ok(errs.length===0,'No JS errors: '+errs.join('|'));console.log(fail?fail+' FAILED':'ALL PASSED');process.exit(fail?1:0);},400);
