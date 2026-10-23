#!/usr/bin/env node
// Projected glyph sizes and sampled digit/backing contrast from phonedetails.mjs witnesses.
import {readFileSync,writeFileSync} from 'node:fs';
import {decodePNG} from './lib/png.mjs';
const folder=process.argv[2]||'tools/qa/out/phone-details/after';const report=JSON.parse(readFileSync(folder+'/report.json'));const out={errors:report.errors,states:[]};
const lin=c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4};
for(const s of report.states){if(s.device==='desktop')continue;const im=decodePNG(readFileSync(s.file));const dpr=im.width/s.metrics.viewport[0];
 const contrast=g=>{const xs=g.corners.map(p=>p[0]*dpr),ys=g.corners.map(p=>p[1]*dpr),v=[];for(let y=Math.max(0,Math.ceil(Math.min(...ys)));y<Math.min(im.height,Math.floor(Math.max(...ys)));y++)for(let x=Math.max(0,Math.ceil(Math.min(...xs)));x<Math.min(im.width,Math.floor(Math.max(...xs)));x++){const i=(y*im.width+x)*4;v.push(.2126*lin(im.data[i])+.7152*lin(im.data[i+1])+.0722*lin(im.data[i+2]));}v.sort((a,b)=>a-b);return v.length?((v[Math.floor(v.length*.95)]+.05)/(v[Math.floor(v.length*.05)]+.05)):null;};
 out.states.push({device:s.device,level:s.level,minDigitCapCSS:s.metrics.digits.length?Math.min(...s.metrics.digits.map(g=>g.height)):null,minDigitContrast:s.metrics.digits.length?Math.min(...s.metrics.digits.map(contrast)):null,minDropInkCSS:s.metrics.dropGlyphs.length?Math.min(...s.metrics.dropGlyphs.map(g=>Math.max(g.width,g.height)*116/128)):null,minPipCSS:s.metrics.pips.length?Math.min(...s.metrics.pips.map(g=>Math.min(g.width,g.height))):null,overlaps:s.layout.overlaps});}
writeFileSync(folder+'/measurements.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
