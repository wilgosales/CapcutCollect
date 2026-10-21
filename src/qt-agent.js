'use strict';
const core=Process.getModuleByName('Qt6Core.dll');
const gui=Process.getModuleByName('Qt6Gui.dll');
const qml=Process.getModuleByName('Qt6Qml.dll');
function ex(mod,pattern){const found=mod.enumerateExports().filter(e=>pattern.test(e.name));if(found.length!==1)throw Error('Ambiguous/missing symbol '+pattern+': '+found.length);return found[0].address;}
function nf(mod,pattern,ret,args){return new NativeFunction(ex(mod,pattern),ret,args,{exceptions:'steal'});}
const current=nf(core,/^\?currentThread@QThread@@/, 'pointer',[]);
const thread=nf(core,/^\?thread@QObject@@/, 'pointer',['pointer']);
const appAddress=ex(core,/^\?self@QCoreApplication@@/);
const app=appAddress.readPointer();
const appThread=thread(app);
const allWindows=nf(gui,/^\?allWindows@QGuiApplication@@/,'pointer',['pointer']);
const inherits=nf(core,/^\?inherits@QObject@@/,'bool',['pointer','pointer']);
const objectName=nf(core,/^\?objectName@QObject@@/,'pointer',['pointer','pointer']);
const qmlContext=nf(qml,/^\?contextForObject@QQmlEngine@@/,'pointer',['pointer']);
const qStringDtor=core.findExportByName('??1QString@@QEAA@XZ');
const destroyQString=qStringDtor?new NativeFunction(qStringDtor,'void',['pointer']):null;
const quickClass=Memory.allocUtf8String('QQuickWindow');
function readList(p){const n=p.add(16).readS64().toNumber();if(n<0||n>100000)throw Error('Incompatible QList: '+n);const data=p.add(8).readPointer();if(n&&data.isNull())throw Error('QList has no data');const values=[];for(let i=0;i<n;i++)values.push(data.add(i*Process.pointerSize).readPointer());return values;}
function qstring(fn,obj){const out=Memory.alloc(24);out.writeByteArray(new Uint8Array(24));fn(obj,out);const size=out.add(16).readS64().toNumber();if(size<0||size>8192)throw Error('Incompatible QString: '+size);const text=size?out.add(8).readPointer().readUtf16String(size):'';if(destroyQString)destroyQString(out);return text;}
function onGui(callback){return new Promise((resolve,reject)=>{
 let done=false;let listener;
 const timer=setTimeout(()=>{if(done)return;done=true;listener.detach();reject(Error('Nenhum evento na thread GUI em 10s'));},10000);
 listener=Interceptor.attach(ex(core,/^\?notifyInternal2@QCoreApplication@@/),{onEnter(){
  if(done||!current().equals(appThread))return;
  done=true;clearTimeout(timer);
  try{resolve(callback());}catch(e){reject(e);}finally{listener.detach();}
 }});
});}
const makeQString=nf(core,/^\?\?0QString@@QEAA@PEBVQChar@@_J@Z$/,'pointer',['pointer','pointer','int64']);
const makeExpression=nf(qml,/^\?\?0QQmlExpression@@QEAA@PEAVQQmlContext@@PEAVQObject@@AEBVQString@@1@Z$/,'pointer',['pointer','pointer','pointer','pointer','pointer']);
const evaluateExpression=nf(qml,/^\?evaluate@QQmlExpression@@/,'pointer',['pointer','pointer','pointer']);
const expressionHasError=nf(qml,/^\?hasError@QQmlExpression@@/,'bool',['pointer']);
const destroyExpression=nf(qml,/^\?\?1QQmlExpression@@UEAA@XZ$/,'void',['pointer']);
const variantToString=nf(core,/^\?toString@QVariant@@QEBA\?AVQString@@XZ$/,'pointer',['pointer','pointer']);
const variantDtor=core.findExportByName('??1QVariant@@QEAA@XZ');
const destroyVariant=variantDtor?new NativeFunction(variantDtor,'void',['pointer']):null;
const isVisible=nf(gui,/^\?isVisible@QWindow@@/,'bool',['pointer']);
function evaluateOnWindow(window,source){
 const sourceData=Memory.allocUtf16String(source),sourceString=Memory.alloc(24);
 makeQString(sourceString,sourceData,source.length);
 const expression=Memory.alloc(512),result=Memory.alloc(64),undefinedFlag=Memory.alloc(1);
 expression.writeByteArray(new Uint8Array(512));result.writeByteArray(new Uint8Array(64));undefinedFlag.writeU8(0);
 const context=qmlContext(window);if(context.isNull())throw Error('Window has no QML context');
 makeExpression(expression,context,window,sourceString,ptr(0));
 try{
  evaluateExpression(expression,result,undefinedFlag);
  if(expressionHasError(expression))throw Error('QML evaluation failed; no further action was performed');
  const value=qstring(variantToString,result);
  return {value,undefined:undefinedFlag.readU8()!==0};
 }finally{destroyExpression(expression);if(destroyVariant)destroyVariant(result);if(destroyQString)destroyQString(sourceString);}
}
function findHome(){
 const list=Memory.alloc(24);list.writeByteArray(new Uint8Array(24));allWindows(list);
 const candidates=readList(list).filter(w=>inherits(w,quickClass)&&qstring(objectName,w)==='HomeWindow'&&isVisible(w));
 if(candidates.length!==1)throw Error('Requires one visible HomeWindow: '+candidates.length);
 return candidates[0];
}
rpc.exports={inspect:()=>onGui(()=>evaluateOnWindow(findHome(),__COLLECT_EXPRESSION__))};
