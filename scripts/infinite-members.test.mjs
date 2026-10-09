import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import vm from 'node:vm';

const root=resolve(fileURLToPath(new URL('..',import.meta.url))),require=createRequire(import.meta.url);
const {create}=require('../src/levels.js'),templates=require('../src/pinball-templates.js');
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const definitions=vm.runInNewContext(html.slice(html.indexOf('const LEVELS ='),html.indexOf('const POWER_TYPES ='))+'; LEVELS');
const make=host=>create({levels:definitions,boards:[0,1,2,3,4],builtinCount:20,templates,host,
    bridge:{isActive:()=>host.active!==false,isReady:()=>host.ready!==false}});

test('Pinball metadata locks floor 21; member specs append; offline and inactive paths have no offer',async()=>{
    let member=false,fail=false,notifications=0;
    const calls=[];
    const row={level_index:20,title:'Sky forge',author_kind:'human',credited_name:'Forge Tester'};
    const host={PickBits:{isAdFree:()=>member,levels:{
        list:async()=>{if(fail)throw new Error('offline');return [];},
        peek:async(slug,options)=>{calls.push({slug,options});return [row];},
        reportFrontier:async()=>{throw Object.assign(new Error('Membership required'),{code:'membership_required'});},
    }}};
    const source=make(host);source.onMembershipRequired(()=>notifications++);await source.refresh();
    assert.equal(source.length,20);assert.deepEqual(source.lockedNext,row);
    await source.complete(19);assert.equal(notifications,1);assert.equal(source.length,20);
    assert(calls.every(c=>c.slug==='pinball'&&c.options.after===19));
    fail=true;await source.refresh();assert.equal(source.lockedNext,null);
    fail=false;member=true;
    const spec=structuredClone(source.levels[0].spec);spec.boardName='Sky forge';
    host.PickBits.levels.list=async(_slug,{after})=>after===19?[{...row,spec}]:[];
    await source.refresh();assert.equal(source.length,21);assert.equal(source.levelFor(20).name,'Sky forge');assert.equal(source.lockedNext,null);
    assert.equal(source.credit(20),'Edge forged by Forge Tester');
    for(const flags of [{active:false},{ready:false},{navigator:{onLine:false}}]) {
        const offline=make({...host,...flags});await offline.refresh();assert.equal(offline.length,20);assert.equal(offline.lockedNext,null);
    }
});

test('Pinball floor 21 locked card follows real 20-floor completion and supports both Join routes and Not now',{timeout:120000},async()=>{
    const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_PATH||'C:/new/asset-factory/node_modules/playwright/index.mjs').href);
    const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
    try {
        const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.route('**/*',async route=>{
            const url=new URL(route.request().url());let file;
            if(url.hostname==='pinball.pickbits.ai')file=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
            else if(url.href.includes('/matter-js/0.19.0/'))file=process.env.MATTER_PATH||'C:/new/pickbits-games/hubs/arcade/node_modules/matter-js/build/matter.min.js';
            else return route.fulfill({contentType:'text/javascript',body:''});
            if(url.hostname==='pinball.pickbits.ai'&&!file.startsWith(root+sep))return route.fulfill({status:403,body:''});
            const mime={'.html':'text/html','.js':'text/javascript','.glb':'model/gltf-binary','.json':'application/json','.png':'image/png','.webp':'image/webp'};
            try{return await route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}
            catch{return route.fulfill({status:404,body:'Missing fixture'});}
        });
        await page.addInitScript(()=>{
            window.Sentry={init(){}};
            window.__calls={checkout:0,signup:[]};window.__authed=false;
            window.PickBits={init(){},onAuthChange:callback=>{window.__auth=callback;},getUser:()=>__authed?{id:'free',username:'Free player'}:null,
                isAdFree:()=>false,isAuthenticated:()=>__authed,
                startArcadePass:async()=>{__calls.checkout++;},promptSignup:opts=>__calls.signup.push(opts),
                levels:{list:async()=>[],peek:async()=>[{level_index:20,title:'Sky forge',author_kind:'human',credited_name:'Forge Tester'}],
                    reportFrontier:async()=>{if(!__authed)throw new Error('Not authenticated');throw Object.assign(new Error('Membership required'),{code:'membership_required'});}},
            };
        });
        await page.goto('http://pinball.pickbits.ai/?pb=1&automation=climb');
        await page.waitForFunction(()=>window.PinballAutomationResult,null,{timeout:60000});
        const result=await page.evaluate(()=>PinballAutomationResult);
        assert.equal(result.status,'PASS',JSON.stringify(result));
        const card=page.getByRole('dialog',{name:'Locked floor'});await card.waitFor();
        const text=await card.textContent();
        for(const copy of ['Floor 21','Sky forge','forged by Forge Tester','Members play beyond the built-ins','Arcade Pass $5/mo'])assert(text.includes(copy),copy);
        assert.equal(await page.evaluate(()=>levelSource.length),20);
        await page.evaluate(async()=>{__authed=true;__auth(PickBits.getUser());await levelSource.complete(19);});
        assert.match(await page.locator('#infinite-membership-toast').textContent(),/Members play beyond the built-ins/);
        await card.getByRole('button',{name:'Join',exact:true}).click();assert.equal(await page.evaluate(()=>__calls.checkout),1);
        await page.evaluate(()=>{__authed=false;});await card.getByRole('button',{name:'Join',exact:true}).click();
        assert.equal(await page.evaluate(()=>new URL(__calls.signup[0].redirect).searchParams.get('pb_intent')),'arcade-pass');
        const box=await card.boundingBox();assert(box.x>=0&&box.x+box.width<=390);
        await card.getByRole('button',{name:'Not now',exact:true}).click();
        assert.equal(await page.locator('.infinite-locked-card').count(),0);assert(await page.locator('#game-over').isVisible());
        assert.deepEqual(errors,[]);
        await context.close();
    }finally{await browser.close();}
});
