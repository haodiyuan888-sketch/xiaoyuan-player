// 小源音乐 - 7个独立音源代理服务器
var http=require('http'),https=require('https'),url=require('url'),fs=require('fs'),path=require('path'),PORT=process.env.PORT||3721;
var CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'*','Access-Control-Allow-Headers':'*'};

function get(u,h,to){h=h||{};to=to||8000;return new Promise(function(R,J){var p=url.parse(u),o={hostname:p.hostname,port:p.port||443,path:p.path,method:'GET',headers:Object.assign({'User-Agent':'Mozilla/5.0','Accept':'application/json'},h),timeout:to},t=p.protocol==='https:'?https:http,r=t.request(o,function(s){var b='';s.on('data',function(c){b+=c});s.on('end',function(){try{R(JSON.parse(b))}catch(e){R({raw:b})}})});r.on('error',J);r.on('timeout',function(){r.destroy();J(new Error('to'))});r.end()})}

// 共享搜索（所有音源的源数据来自网易云）
function search163(kw){return get('https://music.163.com/api/search/get/web?csrf_token=&s='+encodeURIComponent(kw)+'&type=1&offset=0&total=true&limit=30').then(function(d){if(!d||!d.result||!d.result.songs)return[];return d.result.songs.map(function(s){var a=s.album||s.al||{};return{id:String(s.id),name:s.name,artist:(s.artists||s.ar||[]).map(function(x){return x.name}).join(' / '),album:a.name||'',pic:a.picUrl||a.pic||''}})})}
function list163(pid){return get('https://music.163.com/api/v6/playlist/detail?id='+pid+'&n=500').then(function(d){if(!d||!d.playlist||!d.playlist.tracks)return[];return d.playlist.tracks.map(function(s){return{id:String(s.id),name:s.name,artist:(s.ar||[]).map(function(x){return x.name}).join(' / '),album:(s.al||{}).name||'',pic:(s.al||{}).picUrl||''}})})}
function lrc163(sid){return get('https://music.163.com/api/song/lyric?id='+sid+'&lv=1').then(function(d){return(d&&d.lrc&&d.lrc.lyric)?d.lrc.lyric:''})}

// ═══════ 7个独立音源，各有独立URL后端 ═══════
var SRC={
  // 1. 统一音乐源 - music-api.gdstudio.xyz
  tongyi:{name:'统一音乐源',color:'#9b59b6',icon:'🎼',file:'统一音乐源 v1.0.0.js',
    search:search163, playlist:list163, lyric:lrc163,
    urls:function(sid){return[
      {k:'ty_netease',n:'统一源·网易',u:get('https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id='+sid+'&br=320',{},5000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'ty_kuwo',n:'统一源·酷我',u:get('https://music-api.gdstudio.xyz/api.php?types=url&source=kuwo&id='+sid+'&br=320',{},5000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
    ]},
    hot:[{n:'热歌榜',id:'3778678'},{n:'新歌榜',id:'3779629'},{n:'飙升榜',id:'19723756'}]},

  // 2. SVIP音源 - oiapi.net + lxmusicapi
  svip:{name:'SVIP音源',color:'#e91e63',icon:'👑',file:'SVIP音源v1.1.1.js',
    search:search163, playlist:list163, lyric:lrc163,
    urls:function(sid){return[
      {k:'sv_oiapi',n:'SVIP·oiapi',u:get('https://oiapi.net/api/Music_163?id='+sid+'&br=320',{},6000).then(function(d){return(d&&d.data&&d.data.length&&d.data[0].url)?d.data[0].url:null}).catch(function(){return null})},
      {k:'sv_lx_wy',n:'SVIP·lx·网易',u:get('https://lxmusicapi.onrender.com/url/wy/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'sv_lx_kg',n:'SVIP·lx·酷狗',u:get('https://lxmusicapi.onrender.com/url/kg/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
    ]},
    hot:[{n:'热歌榜',id:'3778678'},{n:'新歌榜',id:'3779629'},{n:'飙升榜',id:'19723756'},{n:'抖音榜',id:'2809513713'}]},

  // 3. 独家音源 - lxmusicapi 五平台全覆盖
  dujia:{name:'独家音源',color:'#1abc9c',icon:'⭐',file:'[独家音源] v4.0.js',
    search:search163, playlist:list163, lyric:lrc163,
    urls:function(sid){return[
      {k:'dj_lx_wy',n:'独家·网易云',u:get('https://lxmusicapi.onrender.com/url/wy/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'dj_lx_kg',n:'独家·酷狗',u:get('https://lxmusicapi.onrender.com/url/kg/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'dj_lx_tx',n:'独家·QQ',u:get('https://lxmusicapi.onrender.com/url/tx/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'dj_lx_kw',n:'独家·酷我',u:get('https://lxmusicapi.onrender.com/url/kw/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'dj_lx_mg',n:'独家·咪咕',u:get('https://lxmusicapi.onrender.com/url/mg/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
    ]},
    hot:[{n:'热歌榜',id:'3778678'},{n:'新歌榜',id:'3779629'},{n:'飙升榜',id:'19723756'}]},

  // 4. 全豆要聚合 - 双聚合源
  quandou:{name:'全豆要聚合',color:'#ff5722',icon:'🫘',file:'全豆要-聚合音源 v4.0 TSS解密版.js',
    search:search163, playlist:list163, lyric:lrc163,
    urls:function(sid){return[
      {k:'qd_gd_wy',n:'全豆要·Gd·网易',u:get('https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id='+sid+'&br=320',{},5000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'qd_oi_wy',n:'全豆要·Oi·网易',u:get('https://oiapi.net/api/Music_163?id='+sid+'&br=320',{},6000).then(function(d){return(d&&d.data&&d.data.length&&d.data[0].url)?d.data[0].url:null}).catch(function(){return null})},
      {k:'qd_lx_wy',n:'全豆要·Lx·网易',u:get('https://lxmusicapi.onrender.com/url/wy/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'qd_lx_kg',n:'全豆要·Lx·酷狗',u:get('https://lxmusicapi.onrender.com/url/kg/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
    ]},
    hot:[{n:'热歌榜',id:'3778678'},{n:'新歌榜',id:'3779629'},{n:'飙升榜',id:'19723756'},{n:'抖音榜',id:'2809513713'}]},

  // 5. 聆澜音源 - guoyue2010 + gdstudio
  linglan:{name:'聆澜音源',color:'#00bcd4',icon:'🌊',file:'聆澜音源-兼容端(公益版) v2.js',
    search:search163, playlist:list163, lyric:lrc163,
    urls:function(sid){return[
      {k:'ll_gd_wy',n:'聆澜·Gd·网易',u:get('https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id='+sid+'&br=320',{},5000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'ll_oi_wy',n:'聆澜·Oi·网易',u:get('https://oiapi.net/api/Music_163?id='+sid+'&br=320',{},6000).then(function(d){return(d&&d.data&&d.data.length&&d.data[0].url)?d.data[0].url:null}).catch(function(){return null})},
    ]},
    hot:[{n:'热歌榜',id:'3778678'},{n:'新歌榜',id:'3779629'},{n:'飙升榜',id:'19723756'}]},

  // 6. 野花音源 - 直连优先
  yehua:{name:'野花音源',color:'#ff9800',icon:'🌸',file:'野花音源.js',
    search:search163, playlist:list163, lyric:lrc163,
    urls:function(sid){return[
      {k:'yh_direct',n:'野花·直连',u:Promise.resolve('https://music.163.com/song/media/outer/url?id='+sid+'.mp3')},
      {k:'yh_oi',n:'野花·Oi',u:get('https://oiapi.net/api/Music_163?id='+sid+'&br=320',{},6000).then(function(d){return(d&&d.data&&d.data.length&&d.data[0].url)?d.data[0].url:null}).catch(function(){return null})},
    ]},
    hot:[{n:'热歌榜',id:'3778678'},{n:'新歌榜',id:'3779629'},{n:'飙升榜',id:'19723756'}]},

  // 7. 野草音源 - oiapi第三方代理
  yecao:{name:'野草音源',color:'#8bc34a',icon:'🌿',file:'野草音源.js',
    search:search163, playlist:list163, lyric:lrc163,
    urls:function(sid){return[
      {k:'yc_oi',n:'野草·Oi',u:get('https://oiapi.net/api/Music_163?id='+sid+'&br=320',{},6000).then(function(d){return(d&&d.data&&d.data.length&&d.data[0].url)?d.data[0].url:null}).catch(function(){return null})},
      {k:'yc_direct',n:'野草·直连',u:Promise.resolve('https://music.163.com/song/media/outer/url?id='+sid+'.mp3')},
    ]},
    hot:[{n:'热歌榜',id:'3778678'},{n:'新歌榜',id:'3779629'},{n:'飙升榜',id:'19723756'}]}
};

var KEYS=Object.keys(SRC);

// ═══════ 服务器 ═══════
http.createServer(function(req,res){
  if(req.method==='OPTIONS'){res.writeHead(204,CORS);res.end();return}
  var p=url.parse(req.url,true),pt=p.pathname,q=p.query;
  function send(c,d){res.writeHead(c,Object.assign({'Content-Type':'application/json'},CORS));res.end(JSON.stringify(d))}
  function serveFile(fp,ct){try{res.writeHead(200,ct);res.end(fs.readFileSync(fp))}catch(e){res.writeHead(404);res.end('404')}}

  // 静态文件
  if(pt==='/'||pt==='/index.html'){serveFile(path.join(__dirname,'index.html'),{'Content-Type':'text/html; charset=utf-8'});return}

  if(pt==='/ping')return send(200,{ok:!0,sources:KEYS});
  if(pt==='/api/sources'){return send(200,KEYS.map(function(k){return{key:k,name:SRC[k].name,color:SRC[k].color,icon:SRC[k].icon,file:SRC[k].file,hot:SRC[k].hot||[]}}))}

  // 搜索
  if(pt==='/api/search'){var s=q.source||KEYS[0],kw=(q.keyword||'').trim();if(!kw||!SRC[s]||!SRC[s].search)return send(400,{error:'无效'});SRC[s].search(kw).then(function(v){send(200,v)}).catch(function(e){send(500,{error:e.message})});return}

  // 歌单
  if(pt==='/api/playlist'){var s=q.source||KEYS[0],pid=q.id||'';if(!pid||!SRC[s]||!SRC[s].playlist)return send(400,{error:'无效'});SRC[s].playlist(pid).then(function(v){send(200,v)}).catch(function(e){send(500,{error:e.message})});return}

  // 歌词
  if(pt==='/api/lyric'){var s=q.source||KEYS[0],sid=q.id||'';if(!sid||!SRC[s]||!SRC[s].lyric)return send(400,{error:'无效'});SRC[s].lyric(sid).then(function(v){send(200,{lyric:v})}).catch(function(e){send(500,{error:e.message})});return}

  // 获取指定音源的URL列表
  if(pt==='/api/urls'){var s=q.source||KEYS[0],sid=q.id||'';if(!sid||!SRC[s])return send(400,{error:'无效'});
    var tasks=SRC[s].urls(sid);Promise.all(tasks.map(function(t){return t.u.then(function(url){return{key:t.key,name:t.n,url:url}}).catch(function(){return{key:t.key,name:t.n,url:null}})}))
      .then(function(r){send(200,{id:sid,source:s,urls:r.filter(function(x){return x.url&&x.url.startsWith('http')})})}).catch(function(e){send(500,{error:e.message})});return}

  send(404,{error:'无此接口'});
}).listen(PORT,function(){console.log('☀️ 小源 → http://localhost:'+PORT);KEYS.forEach(function(k){console.log('  '+SRC[k].icon+' '+SRC[k].name+' ['+SRC[k].file+']')})});
