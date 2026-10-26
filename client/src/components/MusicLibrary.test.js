import {JSDOM} from 'jsdom';
import test from 'node:test';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
test('album review preserves field choices and recovers partial saves without replaying successes', async()=>{
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require=createRequire(repo+'/client/package.json');
const React=require('react');const {act}=React;const {createRoot}=require('react-dom/client');
const {createServer}=await import(repo+'/client/node_modules/vite/dist/node/index.js');
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
for(const key of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);globalThis.cancelAnimationFrame=clearTimeout;
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
const vite=await createServer({root:repo+'/client',server:{middlewareMode:true},appType:'custom'});
const {api}=await vite.ssrLoadModule('/src/api.js');
const files=[{path:'Album/one.mp3'},{path:'Album/two.mp3'}];
let applied=[],previews=0,failed=false;
Object.assign(api,{
 listMusicFiles:async()=>({files,truncated:false}),musicTagHistory:async()=>[],musicFingerprintSettings:async()=>({}),
 inspectMusicFile:async path=>({path,tags:{artist:'Artist',album:'Album'},format:'mp3',duration:100}),
 searchMusic:async()=>({results:[{id:'123',name:'Album',artist:'Artist'}]}),
 getMusicAlbum:async()=>({album:{name:'Album',artist:'Artist'},tracks:[1,2].map(n=>({catalogTrackId:String(n),title:`Track ${n}`,discNumber:1,trackNumber:n}))}),
 previewMusicTags:async payload=>({id:payload.path+'-'+(++previews),path:payload.path,changes:[{field:'genre',before:'Folk Rock',after:'Pop',action:'keep',replaceable:true,clearable:true}]}),
 applyMusicTags:async(id,choices)=>{applied.push({id,choices});if(id.startsWith('Album/two')&&!failed){failed=true;throw new Error('Disk error');}}
});
const {default:MusicLibrary}=await vite.ssrLoadModule('/src/components/MusicLibrary.jsx');
const root=createRoot(document.getElementById('root'));
const flush=async fn=>act(async()=>{fn?.();await new Promise(r=>setTimeout(r,20));});
const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text);
const click=async el=>{assert.ok(el,'element exists');assert.equal(el.disabled,false);await flush(()=>el.click());};
const change=async(el,value)=>flush(()=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));});
try {
 await flush(()=>root.render(React.createElement(MusicLibrary)));
 for(const el of document.querySelectorAll('input[type=checkbox]'))await click(el);
 await click(button('Review selected album files (2/50)'));
 const form=[...document.querySelectorAll('form')].find(el=>el.querySelector('[aria-label="Search catalog releases"]'));
 await flush(()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 await click(button('Artist · Album'));
 const selects=[...document.querySelectorAll('select')].filter(el=>el.options[0]?.textContent==='Choose track');
 assert.equal(selects.length,2);
 await change(selects[0],'1');await change(selects[1],'1');
 assert.equal(button('Preview album changes').disabled,true);
 await change(selects[1],'2');await click(button('Preview album changes'));
 assert.equal(previews,2);
 const actions=[...document.querySelectorAll('[aria-label="Action for genre"]')];
 assert.equal(actions.length,2);assert.ok(actions.every(el=>el.value==='keep'));
 await change(actions[0],'replace');
 await click(button('Apply reviewed album tags'));
 assert.equal(applied.length,2);assert.equal(applied[0].choices.genre,'replace');assert.equal(applied[1].choices.genre,'keep');
 assert.equal(button('Apply reviewed album tags').disabled,true);
 await click(button('Preview album changes'));
 assert.equal(previews,3,'fresh preview only for failed file');
 await click(button('Apply reviewed album tags'));
 assert.equal(applied.length,3,'saved file not applied again');
 assert.equal(button('Apply reviewed album tags').disabled,true);

} finally {await flush(()=>root.unmount());await vite.close();}

});
