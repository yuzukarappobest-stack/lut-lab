(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const canvas = $("diagram");
  const ctx = canvas.getContext("2d");
  if (!ctx) { $("status").textContent = "このブラウザではCanvasを利用できません。"; return; }
  const W = 1000, H = 650, SCALE = 82;
  const TYPE = {
    sun: {name:"太陽",symbol:"☀",color:"#f4b74c"},
    point: {name:"点光源",symbol:"✦",color:"#f4b74c"},
    softbox: {name:"面光源",symbol:"▤",color:"#f4b74c"},
    reflector: {name:"レフ板",symbol:"◐",color:"#c4d5e5"}
  };
  const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
  const round = (v,n=1) => Number(v.toFixed(n));
  const rad = a => a*Math.PI/180;
  const deg = a => a*180/Math.PI;
  const scene = {
    version:1, view:"front", lights:[], selected:null, nextId:1,
    photo:{x:258,y:159,w:484,h:322,ratio:484/322},
    imageData:null, showBeams:true, showLabels:true,
    camera:{x:0,y:1.6,z:4}, subject:{x:0,y:0,z:0}
  };
  let photoImage = null;
  let drag = null;
  let promptDirty = false;
  let toastTimer = null;
  const colors = {ink:"#233c4b",muted:"#708492",gold:"#e4ad46",blue:"#4687a8"};
  const kind = t => TYPE[t] || TYPE.point;

  function toast(message) {
    const el=$("toast"); el.textContent=message; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2600);
  }
  function newLight(type) {
    const count=scene.lights.filter(l=>l.type===type).length;
    const light={
      id:scene.nextId++, type, name:kind(type).name+(count?String(count+1):""),
      x:type==="softbox"?-4:type==="point"?3.8:type==="reflector"?-2.7:0,
      y:type==="softbox"?2.2:type==="point"?2.5:1.4,
      z:type==="softbox"?1.5:type==="point"?-1.8:2.8,
      azimuth:65,elevation:40,
      width:type==="softbox"?1.2:0.8,
      height:type==="softbox"?1.0:0.8,
      yaw:type==="softbox"?68:type==="point"?-115:145,
      spread:type==="point"?45:90, power:type==="reflector"?45:100,
      color:type==="reflector"?"#cfdeed":"#f6c65f"
    };
    if(type==="sun"){light.azimuth=65+count*24;light.elevation=40;}
    else {light.x=clamp(light.x+(count*0.65),-5.5,5.5); light.y+=count*0.25;}
    scene.lights.push(light);scene.selected=light.id;update(true);toast(kind(type).name+"を追加しました");
  }
  function selected() {return scene.lights.find(l=>l.id===scene.selected)||null;}
  function pos(light,view) {
    if(light.type==="sun"){
      if(view==="front") return {x:500+Math.sin(rad(light.azimuth))*350,y:482-light.elevation*4.6};
      return {x:500+Math.sin(rad(light.azimuth))*250,y:310+Math.cos(rad(light.azimuth))*250};
    }
    return view==="front" ?
      {x:500+light.x*SCALE,y:375-light.y*SCALE} :
      {x:500+light.x*SCALE,y:310+light.z*SCALE};
  }
  function line(context,x1,y1,x2,y2,color,width=1,dash=[]) {
    context.beginPath();context.setLineDash(dash);context.moveTo(x1,y1);context.lineTo(x2,y2);
    context.strokeStyle=color;context.lineWidth=width;context.stroke();context.setLineDash([]);
  }
  function rounded(context,x,y,w,h,r,fill,stroke) {
    context.beginPath();context.roundRect(x,y,w,h,r);
    if(fill){context.fillStyle=fill;context.fill();}
    if(stroke){context.strokeStyle=stroke;context.lineWidth=2;context.stroke();}
  }
  function text(context,str,x,y,size=15,color=colors.ink,weight="500",align="left"){
    context.fillStyle=color;context.font=weight+" "+size+"px system-ui,-apple-system,sans-serif";
    context.textAlign=align;context.textBaseline="middle";context.fillText(str,x,y);context.textAlign="left";
  }
  function arrow(context,x1,y1,x2,y2,color,width=2,dash=[]) {
    line(context,x1,y1,x2,y2,color,width,dash);
    const a=Math.atan2(y2-y1,x2-x1),len=11;
    context.beginPath();context.moveTo(x2,y2);
    context.lineTo(x2-len*Math.cos(a-.48),y2-len*Math.sin(a-.48));
    context.moveTo(x2,y2);
    context.lineTo(x2-len*Math.cos(a+.48),y2-len*Math.sin(a+.48));
    context.strokeStyle=color;context.lineWidth=width;context.stroke();
  }
  function hexRgb(hex) {
    const s=/^#[0-9a-fA-F]{6}$/.test(hex)?hex:"#f6c65f";
    return [parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)];
  }
  function cone(context,x,y,angle,spread,length,color,reflector=false){
    const rgb=hexRgb(color),half=rad(spread)/2;
    context.save();context.beginPath();context.moveTo(x,y);
    context.arc(x,y,length,angle-half,angle+half);context.closePath();
    const gradient=context.createRadialGradient(x,y,5,x,y,length);
    gradient.addColorStop(0,"rgba("+rgb.join(",")+",0.27)");
    gradient.addColorStop(.65,"rgba("+rgb.join(",")+",0.12)");
    gradient.addColorStop(1,"rgba("+rgb.join(",")+",0)");
    context.fillStyle=gradient;context.fill();
    context.strokeStyle="rgba("+rgb.join(",")+",0.55)";
    context.lineWidth=1.5;context.setLineDash(reflector?[5,7]:[7,6]);
    context.beginPath();
    context.moveTo(x,y);context.lineTo(x+length*Math.cos(angle-half),y+length*Math.sin(angle-half));
    context.moveTo(x,y);context.lineTo(x+length*Math.cos(angle+half),y+length*Math.sin(angle+half));
    context.stroke();context.restore();
  }
  function drawSunRays(context,point,view,l){
    if(!scene.showBeams)return;
    const target={x:500,y:view==="front"?327:310};
    const dx=target.x-point.x,dy=target.y-point.y,d=Math.hypot(dx,dy)||1;
    const vx=dx/d,vy=dy/d,nx=-vy,ny=vx;
    context.save();context.globalAlpha=.78;
    for(let j=-2;j<=2;j++){
      const shift=j*21;
      arrow(context,point.x+vx*37+nx*shift,point.y+vy*37+ny*shift,
        point.x+vx*225+nx*shift,point.y+vy*225+ny*shift,l.color,2.5);
    }
    context.restore();
  }
  function drawRays(context,l,view){
    const p=pos(l,view);
    if(l.type==="sun"){drawSunRays(context,p,view,l);return;}
    if(!scene.showBeams)return;
    let angle;
    if(view==="top")angle=rad(l.yaw-90);
    else angle=Math.atan2(327-p.y,500-p.x);
    cone(context,p.x,p.y,angle,l.spread,310,l.color,l.type==="reflector");
  }
  function drawIcon(context,l,view,active){
    const p=pos(l,view);context.save();context.translate(p.x,p.y);
    if(active){context.beginPath();context.arc(0,0,44,0,Math.PI*2);context.fillStyle="#e2f4ff";context.fill();
      context.strokeStyle="#318dc2";context.lineWidth=2;context.stroke();}
    if(l.type==="sun"){
      context.fillStyle=l.color;context.strokeStyle="#d8a344";context.lineWidth=3;
      context.beginPath();context.arc(0,0,21,0,Math.PI*2);context.fill();context.stroke();
      for(let i=0;i<8;i++){const a=i*Math.PI/4;line(context,29*Math.cos(a),29*Math.sin(a),36*Math.cos(a),36*Math.sin(a),"#d8a344",3);}
    }else if(l.type==="point"){
      context.fillStyle="#fff2c9";context.strokeStyle="#c99843";context.lineWidth=3;
      context.beginPath();context.arc(0,0,21,0,Math.PI*2);context.fill();context.stroke();
      text(context,"✦",0,2,23,"#b47b27","700","center");
    }else if(l.type==="softbox"){
      if(view==="top")context.rotate(rad(l.yaw-90));
      const sw= view==="top"?15:clamp(l.width*23,25,70);
      const sh= view==="top"?clamp(l.width*32,25,90):clamp(l.height*32,25,90);
      rounded(context,-sw/2,-sh/2,sw,sh,3,"#fff2cf","#c89a42");
      line(context,-sw/2+5,-sh/2+5,sw/2-5,sh/2-5,"#e0b668",1.5);
      line(context,-sw/2+5,sh/2-5,sw/2-5,-sh/2+5,"#e0b668",1.5);
    }else{
      context.strokeStyle="#7c9ab0";context.lineWidth=7;
      context.beginPath();context.arc(0,0,27,-Math.PI*.58,Math.PI*.58);context.stroke();
      context.fillStyle="#e3ebf1";context.beginPath();context.arc(-6,0,11,0,Math.PI*2);context.fill();
    }
    context.restore();
    if(scene.showLabels){
      const label=l.name.length>16?l.name.slice(0,15)+"…":l.name;
      const width=Math.max(62,Math.min(190,label.length*15+18));
      rounded(context,clamp(p.x-width/2,4,W-width-4),p.y+44,width,27,7,"rgba(255,255,255,.93)","#e5e9ed");
      text(context,label,clamp(p.x,4+width/2,W-width/2-4),p.y+57,13,colors.ink,"650","center");
    }
  }
  function drawPhoto(context,exporting){
    const p=scene.photo;context.save();
    context.shadowColor="rgba(38,56,73,.13)";context.shadowBlur=20;context.shadowOffsetY=3;
    rounded(context,p.x,p.y,p.w,p.h,3,"#f5f8fa","#cbd7e1");
    context.restore();
    context.save();context.beginPath();context.rect(p.x,p.y,p.w,p.h);context.clip();
    if(photoImage&&photoImage.complete&&photoImage.naturalWidth){
      context.drawImage(photoImage,p.x,p.y,p.w,p.h);
    }else{
      context.fillStyle="#f2f6f8";context.fillRect(p.x,p.y,p.w,p.h);
      context.setLineDash([9,9]);context.strokeStyle="#b8c7d2";context.lineWidth=2;
      context.strokeRect(p.x+7,p.y+7,p.w-14,p.h-14);context.setLineDash([]);
      text(context,"＋",p.x+p.w/2,p.y+p.h/2-37,44,"#9db5c5","300","center");
      text(context,"写真を選んで配置",p.x+p.w/2,p.y+p.h/2+9,21,"#839bad","700","center");
      text(context,"ドラッグで移動・右下をドラッグでサイズ変更",p.x+p.w/2,p.y+p.h/2+40,13,"#91a2ae","400","center");
    }
    context.restore();
    if(!exporting){
      rounded(context,p.x+p.w-14,p.y+p.h-14,24,24,5,"#fff","#3987b2");
      line(context,p.x+p.w-5,p.y+p.h+5,p.x+p.w+6,p.y+p.h-6,"#3d8ab3",2);
    }
  }
  function drawGrid(context,view){
    context.fillStyle="#fff";context.fillRect(0,0,W,H);
    if(view==="front")return;
    context.save();context.strokeStyle="#f1f4f6";context.lineWidth=1;
    for(let x=0;x<=W;x+=50){context.beginPath();context.moveTo(x,0);context.lineTo(x,H);context.stroke();}
    for(let y=0;y<=H;y+=50){context.beginPath();context.moveTo(0,y);context.lineTo(W,y);context.stroke();}
    context.restore();
  }
  function drawTop(context){
    for(let i=1;i<=5;i++){
      context.beginPath();context.arc(500,310,i*SCALE,0,Math.PI*2);
      context.lineWidth=1;context.strokeStyle=i===1?"#cadbe3":"#e5edf1";context.setLineDash([4,7]);context.stroke();context.setLineDash([]);
    }
    line(context,500,35,500,625,"#c7d6df",1,[5,6]);
    line(context,70,310,930,310,"#c7d6df",1,[5,6]);
    text(context,"被写体の後ろ",500,48,14,colors.muted,"600","center");
    text(context,"撮影者側（前）",500,626,14,colors.muted,"600","center");
    rounded(context,462,548,76,42,9,"#daeaf3","#7097ae");
    text(context,"CAMERA",500,570,13,"#335d77","800","center");
    arrow(context,500,545,500,398,"#6b91a5",3,[6,5]);
    context.fillStyle="#607f91";context.beginPath();context.arc(500,310,24,0,Math.PI*2);context.fill();
    text(context,"被写体",500,360,16,colors.ink,"750","center");
    text(context,"← 左",95,320,13,colors.muted,"550");
    text(context,"右 →",865,320,13,colors.muted,"550");
  }
  function renderView(context,view,exporting=false){
    drawGrid(context,view);
    text(context,view==="front"?"PHOTO VIEW / 正面":"TOP VIEW / 俯瞰",24,30,19,"#42647c","800");
    text(context,view==="front"?"写真は見た目だけを配置。光源は概念上の位置です。":"中心が被写体、下がカメラ。ドラッグで前後左右を編集。",24,55,13,"#8795a1");
    if(view==="front")drawPhoto(context,exporting);else drawTop(context);
    for(const l of scene.lights)drawRays(context,l,view);
    for(const l of scene.lights)drawIcon(context,l,view,!exporting&&l.id===scene.selected);
    if(!scene.lights.length){
      text(context,"左のメニューから太陽や面光源を追加できます",500,610,14,"#8ca0ac","500","center");
    }
  }
  function draw(){renderView(ctx,scene.view,false);}
  function update(withFields=false){
    draw(); renderList();
    if(withFields) renderFields();
    if(!promptDirty)$("prompt").value=buildPrompt();
    $("lightCount").textContent=scene.lights.length;
    $("status").textContent=scene.lights.length+"灯の光源を配置中 · "+(photoImage?"写真あり":"写真なし");
    $("viewHint").textContent=scene.view==="front"?"写真と光源をドラッグして移動":"ドラッグで左右・前後を変更";
  }
  function renderList(){
    const container=$("lightList");container.replaceChildren();
    if(!scene.lights.length){const e=document.createElement("p");e.className="aside-help";e.textContent="まだ光源がありません。";container.append(e);}
    scene.lights.forEach(l=>{
      const b=document.createElement("button");b.type="button";b.className="light-item"+(l.id===scene.selected?" active":"");
      const ico=document.createElement("span");ico.className="light-ico";ico.textContent=kind(l.type).symbol;
      const wrapper=document.createElement("span");wrapper.className="light-item-text";
      const name=document.createElement("div");name.className="light-item-name";name.textContent=l.name;
      const type=document.createElement("div");type.className="light-item-type";type.textContent=kind(l.type).name;
      wrapper.append(name,type);b.append(ico,wrapper);
      b.addEventListener("click",()=>{scene.selected=l.id;update(true);});
      container.append(b);
    });
  }
  const fields={
    power:{key:"power",out:"powerOut",fmt:v=>v+"%"},
    widthRange:{key:"width",out:"widthOut",fmt:v=>v+" m"},
    heightRange:{key:"height",out:"heightOut",fmt:v=>v+" m"},
    spread:{key:"spread",out:"spreadOut",fmt:v=>v+"°"},
    yaw:{key:"yaw",out:"yawOut",fmt:v=>v+"°"},
    azimuth:{key:"azimuth",out:"azimuthOut",fmt:v=>v+"°"},
    elevation:{key:"elevation",out:"elevationOut",fmt:v=>v+"°"},
    posX:{key:"x",out:"posXOut",fmt:v=>v+" m"},
    posY:{key:"y",out:"posYOut",fmt:v=>v+" m"},
    posZ:{key:"z",out:"posZOut",fmt:v=>v+" m"}
  };
  function renderFields(){
    const l=selected();
    $("propertyFields").hidden=!l;$("emptyProperties").hidden=!!l;
    $("deleteLight").hidden=!l;
    $("propertyTitle").textContent=l?l.name+" の設定":"光源の設定";
    if(!l)return;
    $("lightName").value=l.name;$("lightColor").value=l.color;
    for(const [id,d] of Object.entries(fields)){
      $(id).value=l[d.key];$(d.out).textContent=d.fmt(l[d.key]);
    }
    const isSun=l.type==="sun",isSoft=l.type==="softbox",reflector=l.type==="reflector";
    $("azimuthField").hidden=!isSun;$("elevationField").hidden=!isSun;
    $("widthField").hidden=isSun;$("heightField").hidden=!isSoft;
    $("spreadField").hidden=isSun;$("yawField").hidden=isSun;
    $("positionXField").hidden=isSun;$("positionYField").hidden=isSun;$("positionZField").hidden=isSun;
    $("spreadField").querySelector("span").firstChild.textContent=reflector?"反射範囲 ":"照射角 ";
  }
  function relativeX(x){return x>0.25?"カメラから見て右":x<-.25?"カメラから見て左":"被写体の正面中央付近";}
  function relativeZ(z){return z>0.25?"被写体よりカメラ側":z<-.25?"被写体の後方":"被写体とほぼ同じ奥行き";}
  function lightingData(){
    return {
      schema:"lighting-studio/v1",
      coordinateSystem:"被写体を原点（0,0,0）、Xは写真の右、Yは上、Zは被写体からカメラ方向。距離は相対的なメートル表記で撮影実測値ではありません。",
      camera:{...scene.camera},subject:{...scene.subject},
      lights:scene.lights.map(l=>{
        const common={id:l.id,name:l.name,type:l.type,powerPercent:l.power,colorHex:l.color};
        if(l.type==="sun")return {...common,infiniteDistance:true,azimuthDegrees:l.azimuth,elevationDegrees:l.elevation};
        return {...common,position:{x:round(l.x),y:round(l.y),z:round(l.z)},widthMeters:round(l.width),
          heightMeters:round(l.height),beamYawDegrees:l.yaw,beamSpreadDegrees:l.spread,passiveReflector:l.type==="reflector"};
      })
    };
  }
  function buildPrompt(){
    const note=$("intent").value.trim();
    if($("promptMode").value!=="detailed"){
      const lines=[
        "元写真を、添付したライティング図のようにライティングしてください。",
        "被写体の形や姿勢、構図・画角・背景は変更せず、光の当たり方だけを変更してください。",
        "図の線や光源アイコンは完成写真に入れないでください。"
      ];
      if(note)lines.push("",note);
      return lines.join("\n");
    }
    const lines=[
      "添付する元写真を基準に、以下のライティング設計を反映した撮影イメージを生成してください。",
      "同封するライティング図は光源の配置説明です。図そのものを元写真に描き込まないでください。",
      "",
      "【最優先の保持条件】",
      "元写真の構図、画角、被写体の形・顔・模様・姿勢、背景の物体配置をできるだけ維持してください。新しい被写体や小物を追加しないでください。",
      "光による明暗、陰影、ハイライト、反射、色温度、背景との分離感を中心に変更してください。",
      "",
      "【カメラと被写体】",
      "被写体を原点とし、カメラは被写体の正面にあります。左右はカメラから見た方向です。",
      "各座標・光量・サイズは撮影設計の相対的な目安であり、厳密な測光値ではありません。",
      "",
      "【光源の設計】"
    ];
    if(!scene.lights.length)lines.push("光源は未設定です。添付された図を参考に自然なライティングにしてください。");
    scene.lights.forEach((l,i)=>{
      if(l.type==="sun"){
        lines.push((i+1)+". "+l.name+"（太陽、無限遠の平行光）：方位 "+l.azimuth+"°（カメラ方向を0°、右が正）、高度 "+l.elevation+"°。相対光量 "+l.power+"%、光色 "+l.color+"。自然な平行光と一貫した影の方向を表現。");
      }else{
        const typeName=l.type==="softbox"?"大型の面光源":l.type==="reflector"?"反射板（自らは発光しない）":"小さな光源";
        lines.push((i+1)+". "+l.name+"（"+typeName+"）："+relativeX(l.x)+"、"+relativeZ(l.z)+"、高さ "+round(l.y)+"m。"+
          "位置("+round(l.x)+","+round(l.y)+","+round(l.z)+")、サイズ "+round(l.width)+"×"+round(l.height)+"m、水平照射方位 "+l.yaw+"°、"+
          "照射/反射の広がり "+l.spread+"°、相対的な光の寄与 "+l.power+"%、光色 "+l.color+"。");
      }
    });
    if(note)lines.push("","【仕上がりの希望】",note);
    lines.push("","【出力】","元写真を再ライティングした完成イメージを1枚生成してください。光源アイコン、矢印、図、文字、透かしは完成写真に入れないでください。"+
      "隠れている面の形状・影・反射特性は推定になるため、見た目の整合性を優先してください。");
    return lines.join("\n");
  }
  function coordinates(event){
    const r=canvas.getBoundingClientRect();
    return {x:(event.clientX-r.left)*W/r.width,y:(event.clientY-r.top)*H/r.height};
  }
  function hitLight(p){
    for(let i=scene.lights.length-1;i>=0;i--){
      const l=scene.lights[i],v=pos(l,scene.view);
      if(Math.hypot(v.x-p.x,v.y-p.y)<44)return l;
    }
    return null;
  }
  canvas.addEventListener("pointerdown",e=>{
    if(e.button!==0&&e.pointerType==="mouse")return;
    const p=coordinates(e);
    const l=hitLight(p);
    if(l){scene.selected=l.id;drag={kind:"light",id:l.id};update(true);}
    else if(scene.view==="front"){
      const img=scene.photo;
      if(p.x>=img.x+img.w-34&&p.x<=img.x+img.w+32&&p.y>=img.y+img.h-34&&p.y<=img.y+img.h+32)
        drag={kind:"resize",start:p,w:img.w,h:img.h};
      else if(p.x>=img.x&&p.x<=img.x+img.w&&p.y>=img.y&&p.y<=img.y+img.h)
        drag={kind:"photo",offX:p.x-img.x,offY:p.y-img.y};
      else{scene.selected=null;update(true);}
    }else{scene.selected=null;update(true);}
    if(drag){e.preventDefault();canvas.setPointerCapture(e.pointerId);}
  });
  canvas.addEventListener("pointermove",e=>{
    if(!drag)return;
    const p=coordinates(e),l=selected();
    if(drag.kind==="light"&&l&&l.id===drag.id){
      if(l.type==="sun"){
        if(scene.view==="top")l.azimuth=round(deg(Math.atan2(p.x-500,p.y-310)),0);
        else{
          l.azimuth=round(deg(Math.asin(clamp((p.x-500)/350,-1,1))),0);
          l.elevation=round(clamp((482-p.y)/4.6,0,90),0);
        }
      }else if(scene.view==="front"){
        l.x=round(clamp((p.x-500)/SCALE,-6,6));l.y=round(clamp((375-p.y)/SCALE,-1,6));
      }else{
        l.x=round(clamp((p.x-500)/SCALE,-6,6));l.z=round(clamp((p.y-310)/SCALE,-5,5));
      }
    }else if(drag.kind==="photo"){
      scene.photo.x=round(clamp(p.x-drag.offX,0,W-scene.photo.w),0);
      scene.photo.y=round(clamp(p.y-drag.offY,65,H-scene.photo.h),0);
    }else if(drag.kind==="resize"){
      const w=clamp(drag.w+(p.x-drag.start.x),140,Math.min(W-scene.photo.x,(H-scene.photo.y)*scene.photo.ratio));
      scene.photo.w=round(w,0);scene.photo.h=round(w/scene.photo.ratio,0);
    }
    update(false);
    if(l)renderFields();
  });
  function endDrag(){drag=null;}
  canvas.addEventListener("pointerup",endDrag);
  canvas.addEventListener("pointercancel",endDrag);
  canvas.addEventListener("lostpointercapture",endDrag);

  function setPhoto(data,preservePlacement=false){
    if(!data){photoImage=null;scene.imageData=null;update();return;}
    const image=new Image();
    image.onload=()=>{
      photoImage=image;scene.imageData=data;
      if(!preservePlacement){
        scene.photo.ratio=image.width/image.height;
        scene.photo.w=Math.min(570,440*scene.photo.ratio,850);
        scene.photo.h=scene.photo.w/scene.photo.ratio;
        if(scene.photo.h>450){scene.photo.h=450;scene.photo.w=450*scene.photo.ratio;}
        scene.photo.x=(W-scene.photo.w)/2;
        scene.photo.y=(H-scene.photo.h)/2;
      }
      update();toast("写真を読み込みました");
    };
    image.onerror=()=>toast("画像の読み込みに失敗しました");
    image.src=data;
  }
  $("photoInput").addEventListener("change",e=>{
    const file=e.target.files&&e.target.files[0];if(!file)return;
    if(!file.type.startsWith("image/")){toast("画像ファイルを選択してください");return;}
    const reader=new FileReader();
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        const max=2000,scale=Math.min(1,max/Math.max(img.width,img.height));
        const c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));
        const cx=c.getContext("2d");cx.drawImage(img,0,0,c.width,c.height);
        setPhoto(c.toDataURL("image/jpeg",.91));
      };
      img.onerror=()=>toast("この画像形式はブラウザで開けません");
      img.src=reader.result;
    };
    reader.onerror=()=>toast("ファイルの読み込みに失敗しました");
    reader.readAsDataURL(file);e.target.value="";
  });
  document.querySelectorAll("[data-add]").forEach(b=>b.addEventListener("click",()=>newLight(b.dataset.add)));
  for(const [id,d] of Object.entries(fields)){
    $(id).addEventListener("input",e=>{
      const l=selected();if(!l)return;
      l[d.key]=Number(e.target.value);$(d.out).textContent=d.fmt(l[d.key]);update(false);
    });
  }
  $("lightName").addEventListener("input",e=>{const l=selected();if(!l)return;l.name=e.target.value||kind(l.type).name;update();$("propertyTitle").textContent=l.name+" の設定";});
  $("lightColor").addEventListener("input",e=>{const l=selected();if(!l)return;l.color=e.target.value;update();});
  $("deleteLight").addEventListener("click",()=>{
    const l=selected();if(!l)return;
    scene.lights=scene.lights.filter(v=>v.id!==l.id);scene.selected=null;update(true);toast("光源を削除しました");
  });
  function setView(v){
    scene.view=v;
    $("frontTab").classList.toggle("active",v==="front");$("topTab").classList.toggle("active",v==="top");
    $("frontTab").setAttribute("aria-selected",String(v==="front"));
    $("topTab").setAttribute("aria-selected",String(v==="top"));
    update();
  }
  $("frontTab").addEventListener("click",()=>setView("front"));
  $("topTab").addEventListener("click",()=>setView("top"));
  $("centerPhoto").addEventListener("click",()=>{
    scene.photo.x=(W-scene.photo.w)/2;scene.photo.y=(H-scene.photo.h)/2;
    setView("front");toast("写真を中央に配置しました");
  });
  $("resetBtn").addEventListener("click",()=>{
    if(!confirm("光源配置と写真を初期化しますか？"))return;
    scene.lights=[];scene.selected=null;scene.nextId=1;scene.photo={x:258,y:159,w:484,h:322,ratio:484/322};
    scene.imageData=null;photoImage=null;promptDirty=false;$("intent").value="";$("promptMode").value="simple";
    setView("front");update(true);toast("初期化しました");
  });
  $("showBeams").addEventListener("change",e=>{scene.showBeams=e.target.checked;update();});
  $("showLabels").addEventListener("change",e=>{scene.showLabels=e.target.checked;update();});
  $("intent").addEventListener("input",()=>{if(!promptDirty)$("prompt").value=buildPrompt();});
  $("promptMode").addEventListener("change",()=>{promptDirty=false;$("prompt").value=buildPrompt();});
  $("prompt").addEventListener("input",()=>{promptDirty=true;});
  $("regenerate").addEventListener("click",()=>{promptDirty=false;$("prompt").value=buildPrompt();toast("説明文を再生成しました");});
  async function copy(textValue){
    try{
      if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(textValue);
      else{
        const el=$("prompt");el.focus();el.select();
        if(!document.execCommand("copy"))throw Error("copy failed");
      }
      toast("コピーしました");
    }catch(e){$("prompt").focus();$("prompt").select();toast("文章を選択しました。手動でコピーしてください");}
  }
  $("copyPrompt").addEventListener("click",()=>copy($("prompt").value));
  function downloadBlob(blob,filename){
    const url=URL.createObjectURL(blob);const a=document.createElement("a");
    a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function jsonFile(value,name){downloadBlob(new Blob([JSON.stringify(value,null,2)],{type:"application/json;charset=utf-8"}),name);}
  $("jsonBtn").addEventListener("click",()=>{jsonFile(lightingData(),"lighting-data.json");toast("光源データを書き出しました");});
  $("txtBtn").addEventListener("click",()=>{downloadBlob(new Blob([$("prompt").value],{type:"text/plain;charset=utf-8"}),"lighting-prompt.txt");toast("指示文を書き出しました");});
  $("saveBtn").addEventListener("click",()=>{
    jsonFile({app:"Lighting Studio",version:1,scene:{
      lights:scene.lights,photo:scene.photo,imageData:scene.imageData,showBeams:scene.showBeams,showLabels:scene.showLabels,
      nextId:scene.nextId},intent:$("intent").value,promptMode:$("promptMode").value,prompt:$("prompt").value},"lighting-project.json");
    toast("再編集できるプロジェクトを保存しました");
  });
  $("projectInput").addEventListener("change",async e=>{
    const file=e.target.files&&e.target.files[0];if(!file)return;
    try{
      if(file.size>30000000)throw Error("ファイルが大きすぎます");
      const data=JSON.parse(await file.text());
      if(data.app!=="Lighting Studio"||!data.scene||!Array.isArray(data.scene.lights))throw Error("対応するプロジェクト形式ではありません");
      scene.lights=data.scene.lights.filter(l=>TYPE[l.type]).slice(0,60).map((l,i)=>({
        id:i+1,type:l.type,name:String(l.name||kind(l.type).name).slice(0,40),
        x:clamp(Number(l.x)||0,-6,6),y:clamp(Number(l.y)||0,-1,6),z:clamp(Number(l.z)||0,-5,5),
        azimuth:clamp(Number(l.azimuth)||0,-180,180),elevation:clamp(Number(l.elevation)||0,0,90),
        width:clamp(Number(l.width)||1,.2,4),height:clamp(Number(l.height)||1,.2,3),
        yaw:clamp(Number(l.yaw)||0,-180,180),spread:clamp(Number(l.spread)||80,10,170),
        power:clamp(Number(l.power)||0,0,200),color:/^#[0-9a-fA-F]{6}$/.test(l.color)?l.color:"#f6c65f"
      }));
      scene.nextId=scene.lights.length+1;scene.selected=null;
      scene.showBeams=data.scene.showBeams!==false;scene.showLabels=data.scene.showLabels!==false;
      $("showBeams").checked=scene.showBeams;$("showLabels").checked=scene.showLabels;
      $("intent").value=typeof data.intent==="string"?data.intent:"";
      $("promptMode").value=data.promptMode==="detailed"?"detailed":"simple";
      if(data.scene.imageData&&typeof data.scene.imageData==="string"&&data.scene.imageData.startsWith("data:image/")){
        setPhoto(data.scene.imageData,true);
      }else{photoImage=null;scene.imageData=null;}
      if(data.scene.photo&&Number.isFinite(data.scene.photo.w)){
        const p=data.scene.photo;
        scene.photo={x:clamp(+p.x||0,0,999),y:clamp(+p.y||0,0,649),
          w:clamp(+p.w||400,80,1000),h:clamp(+p.h||300,80,650),
          ratio:clamp(+p.ratio||1.5,.1,10)};
        if(scene.photo.x+scene.photo.w>W)scene.photo.x=Math.max(0,W-scene.photo.w);
        if(scene.photo.y+scene.photo.h>H)scene.photo.y=Math.max(0,H-scene.photo.h);
      }
      promptDirty=false;setView("front");update(true);
      if(typeof data.prompt==="string"&&data.prompt&&data.prompt!==buildPrompt()){$("prompt").value=data.prompt;promptDirty=true;}
      toast("プロジェクトを開きました");
    }catch(err){toast("読み込みエラー: "+err.message);}
    e.target.value="";
  });
  $("exportBtn").addEventListener("click",()=>{
    const out=document.createElement("canvas");out.width=2040;out.height=780;
    const ox=out.getContext("2d");
    ox.fillStyle="#f3f6f8";ox.fillRect(0,0,out.width,out.height);
    ox.save();ox.translate(10,60);renderView(ox,"front",true);ox.restore();
    ox.save();ox.translate(1030,60);renderView(ox,"top",true);ox.restore();
    text(ox,"LIGHTING STUDIO  |  LIGHTING PLAN",24,31,22,"#1b384a","850");
    text(ox,"撮影イメージ設計図 / 光源配置の概念図",25,745,16,"#647987");
    text(ox,"座標は相対位置・図は測光結果ではありません",2010,745,14,"#647987","500","right");
    out.toBlob(blob=>{if(blob){downloadBlob(blob,"lighting-diagram.png");toast("正面＋俯瞰図を保存しました");}
      else toast("PNG保存に失敗しました");},"image/png");
  });
  update(true);
})();