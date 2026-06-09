// 小源音乐 - 7个独立音源代理服务器
var http=require('http'),https=require('https'),url=require('url'),fs=require('fs'),path=require('path'),PORT=process.env.PORT||3721;
var CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'*','Access-Control-Allow-Headers':'*'};

var UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
var NETEASE_HDR={'User-Agent':UA,'Referer':'https://music.163.com/','Accept':'application/json','Accept-Language':'zh-CN,zh;q=0.9'};

function get(u,h,to){h=h||{};to=to||10000;return new Promise(function(R,J){var p=url.parse(u),o={hostname:p.hostname,port:p.port||(p.protocol==='https:'?443:80),path:p.path,method:'GET',headers:Object.assign({},NETEASE_HDR,h),timeout:to},t=p.protocol==='https:'?https:http,r=t.request(o,function(s){var b='';s.on('data',function(c){b+=c});s.on('end',function(){try{R(JSON.parse(b))}catch(e){R({raw:b,code:s.statusCode})}})});r.on('error',function(e){J(e)});r.on('timeout',function(){r.destroy();J(new Error('请求超时('+to+'ms)'))});r.end()})}

// ── 网易云原生 API（歌单/歌词工作正常，搜索会因海外IP返回空）──
function list163(pid){
  return get('https://music.163.com/api/v6/playlist/detail?id='+pid+'&n=500',{},8000)
  .then(function(d){
    if(!d||!d.playlist) throw new Error('歌单加载失败: '+(d.code||'unknown'));
    if(!d.playlist.tracks||!d.playlist.tracks.length) return[];
    return d.playlist.tracks.map(function(s){return{id:String(s.id),name:s.name,artist:(s.ar||[]).map(function(x){return x.name}).join(' / '),album:(s.al||{}).name||'',pic:(s.al||{}).picUrl||''}})
  })
}

function lrc163(sid){
  return get('https://music.163.com/api/song/lyric?id='+sid+'&lv=1',{},6000)
  .then(function(d){return(d&&d.lrc&&d.lrc.lyric)?d.lrc.lyric:''})
}

// ── 搜索回退链：网易云搜索 → gdstudio代理 → 网易云suggest ──

function search163(kw){
  return get('https://music.163.com/api/search/get/web?csrf_token=&s='+encodeURIComponent(kw)+'&type=1&offset=0&total=true&limit=30',{},5000)
  .then(function(d){
    if(!d||!d.result) throw new Error('网易搜索返回空: '+(d.code||'unknown'));
    if(!d.result.songs||!d.result.songs.length) return[];
    return d.result.songs.map(function(s){var a=s.album||s.al||{};return{id:String(s.id),name:s.name,artist:(s.artists||s.ar||[]).map(function(x){return x.name}).join(' / '),album:a.name||'',pic:a.picUrl||a.pic||''}})
  })
}

function searchGd(kw){
  return get('https://music-api.gdstudio.xyz/api.php?types=search&source=netease&name='+encodeURIComponent(kw),{},8000)
  .then(function(d){
    if(!Array.isArray(d)||!d.length) return[];
    return d.map(function(it){return{id:String(it.id),name:it.name,artist:Array.isArray(it.artist)?it.artist.join(' / '):(it.artist||''),album:it.album||'',pic:it.pic_id?'https://music.163.com/api/img/song/'+it.pic_id:''}})
  })
}

function searchSuggest(kw){
  return get('https://music.163.com/api/search/suggest/web?csrf_token=&s='+encodeURIComponent(kw)+'&limit=30',{},6000)
  .then(function(d){
    if(!d||!d.result) return[];
    var songs=(d.result.songs||[]).map(function(s){return{id:String(s.id),name:s.name,artist:(s.artists||s.ar||[]).map(function(x){return x.name}).join(' / '),album:(s.album||s.al||{}).name||'',pic:(s.album||s.al||{}).picUrl||''}})
    return songs
  })
}

function searchSong(kw){
  return search163(kw).then(function(r){if(r.length)return r;return searchGd(kw).then(function(r2){if(r2.length)return r2;return searchSuggest(kw)})}).catch(function(){return searchGd(kw).then(function(r2){if(r2.length)return r2;return searchSuggest(kw)}).catch(function(){return searchSuggest(kw)})})
}

// ═══════ 7个独立音源 ═══════
var SRC={
  tongyi:{name:'统一音乐源',color:'#9b59b6',icon:'🎼',file:'统一音乐源 v1.0.0.js',
    search:searchSong, playlist:list163, lyric:lrc163,
    urls:function(sid){return[
      {k:'ty_netease',n:'统一源·网易',u:get('https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id='+sid+'&br=320',{},5000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'ty_kuwo',n:'统一源·酷我',u:get('https://music-api.gdstudio.xyz/api.php?types=url&source=kuwo&id='+sid+'&br=320',{},5000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
    ]},
    hot:[{n:'热歌榜',id:'3778678'},{n:'新歌榜',id:'3779629'},{n:'飙升榜',id:'19723756'}]},

  svip:{name:'SVIP音源',color:'#e91e63',icon:'👑',file:'SVIP音源v1.1.1.js',
    search:searchSong, playlist:list163, lyric:lrc163,
    urls:function(sid){return[
      {k:'sv_oiapi',n:'SVIP·oiapi',u:get('https://oiapi.net/api/Music_163?id='+sid+'&br=320',{},6000).then(function(d){return(d&&d.data&&d.data.length&&d.data[0].url)?d.data[0].url:null}).catch(function(){return null})},
      {k:'sv_lx_wy',n:'SVIP·lx·网易',u:get('https://lxmusicapi.onrender.com/url/wy/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'sv_lx_kg',n:'SVIP·lx·酷狗',u:get('https://lxmusicapi.onrender.com/url/kg/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
    ]},
    hot:[{n:'热歌榜',id:'3778678'},{n:'新歌榜',id:'3779629'},{n:'飙升榜',id:'19723756'},{n:'抖音榜',id:'2809513713'}]},

  dujia:{name:'独家音源',color:'#1abc9c',icon:'⭐',file:'[独家音源] v4.0.js',
    search:searchSong, playlist:list163, lyric:lrc163,
    urls:function(sid){return[
      {k:'dj_lx_wy',n:'独家·网易云',u:get('https://lxmusicapi.onrender.com/url/wy/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'dj_lx_kg',n:'独家·酷狗',u:get('https://lxmusicapi.onrender.com/url/kg/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'dj_lx_tx',n:'独家·QQ',u:get('https://lxmusicapi.onrender.com/url/tx/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'dj_lx_kw',n:'独家·酷我',u:get('https://lxmusicapi.onrender.com/url/kw/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'dj_lx_mg',n:'独家·咪咕',u:get('https://lxmusicapi.onrender.com/url/mg/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
    ]},
    hot:[{n:'热歌榜',id:'3778678'},{n:'新歌榜',id:'3779629'},{n:'飙升榜',id:'19723756'}]},

  quandou:{name:'全豆要聚合',color:'#ff5722',icon:'🫘',file:'全豆要-聚合音源 v4.0 TSS解密版.js',
    search:searchSong, playlist:list163, lyric:lrc163,
    urls:function(sid){return[
      {k:'qd_gd_wy',n:'全豆要·Gd·网易',u:get('https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id='+sid+'&br=320',{},5000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'qd_oi_wy',n:'全豆要·Oi·网易',u:get('https://oiapi.net/api/Music_163?id='+sid+'&br=320',{},6000).then(function(d){return(d&&d.data&&d.data.length&&d.data[0].url)?d.data[0].url:null}).catch(function(){return null})},
      {k:'qd_lx_wy',n:'全豆要·Lx·网易',u:get('https://lxmusicapi.onrender.com/url/wy/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'qd_lx_kg',n:'全豆要·Lx·酷狗',u:get('https://lxmusicapi.onrender.com/url/kg/'+sid+'/320k',{'X-Request-Key':'share-v3'},4000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
    ]},
    hot:[{n:'热歌榜',id:'3778678'},{n:'新歌榜',id:'3779629'},{n:'飙升榜',id:'19723756'},{n:'抖音榜',id:'2809513713'}]},

  linglan:{name:'聆澜音源',color:'#00bcd4',icon:'🌊',file:'聆澜音源-兼容端(公益版) v2.js',
    search:searchSong, playlist:list163, lyric:lrc163,
    urls:function(sid){return[
      {k:'ll_gd_wy',n:'聆澜·Gd·网易',u:get('https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id='+sid+'&br=320',{},5000).then(function(d){return(d&&d.url)?d.url:null}).catch(function(){return null})},
      {k:'ll_oi_wy',n:'聆澜·Oi·网易',u:get('https://oiapi.net/api/Music_163?id='+sid+'&br=320',{},6000).then(function(d){return(d&&d.data&&d.data.length&&d.data[0].url)?d.data[0].url:null}).catch(function(){return null})},
    ]},
    hot:[{n:'热歌榜',id:'3778678'},{n:'新歌榜',id:'3779629'},{n:'飙升榜',id:'19723756'}]},

  yehua:{name:'野花音源',color:'#ff9800',icon:'🌸',file:'野花音源.js',
    search:searchSong, playlist:list163, lyric:lrc163,
    urls:function(sid){return[
      {k:'yh_direct',n:'野花·直连',u:Promise.resolve('https://music.163.com/song/media/outer/url?id='+sid+'.mp3')},
      {k:'yh_oi',n:'野花·Oi',u:get('https://oiapi.net/api/Music_163?id='+sid+'&br=320',{},6000).then(function(d){return(d&&d.data&&d.data.length&&d.data[0].url)?d.data[0].url:null}).catch(function(){return null})},
    ]},
    hot:[{n:'热歌榜',id:'3778678'},{n:'新歌榜',id:'3779629'},{n:'飙升榜',id:'19723756'}]},

  yecao:{name:'野草音源',color:'#8bc34a',icon:'🌿',file:'野草音源.js',
    search:searchSong, playlist:list163, lyric:lrc163,
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

  if(pt==='/'||pt==='/index.html'){serveFile(path.join(__dirname,'index.html'),{'Content-Type':'text/html; charset=utf-8'});return}

  if(pt==='/ping'){
    get('https://music.163.com/api/search/get/web?csrf_token=&s=test&type=1&offset=0&total=false&limit=1',{},5000)
    .then(function(d){send(200,{ok:!0,sources:KEYS,netease:{accessible:!!(d&&d.result),code:d.code||0}})})
    .catch(function(e){send(200,{ok:!0,sources:KEYS,netease:{accessible:false,error:e.message}})})
    return
  }

  if(pt==='/api/sources'){return send(200,KEYS.map(function(k){return{key:k,name:SRC[k].name,color:SRC[k].color,icon:SRC[k].icon,file:SRC[k].file,hot:SRC[k].hot||[]}}))}

  // 搜索
  if(pt==='/api/search'){
    var s=q.source||KEYS[0],kw=(q.keyword||'').trim();
    if(!kw||!SRC[s]||!SRC[s].search) return send(400,{error:'无效参数'});
    SRC[s].search(kw).then(function(v){send(200,v)}).catch(function(e){send(500,{error:'搜索失败: '+e.message})})
    return
  }

  // 歌单
  if(pt==='/api/playlist'){
    var s=q.source||KEYS[0],pid=q.id||'';
    if(!pid||!SRC[s]||!SRC[s].playlist) return send(400,{error:'无效参数'});
    SRC[s].playlist(pid).then(function(v){send(200,v)}).catch(function(e){send(500,{error:'歌单加载失败: '+e.message})})
    return
  }

  // 歌词
  if(pt==='/api/lyric'){
    var s=q.source||KEYS[0],sid=q.id||'';
    if(!sid||!SRC[s]||!SRC[s].lyric) return send(400,{error:'无效参数'});
    SRC[s].lyric(sid).then(function(v){send(200,{lyric:v})}).catch(function(e){send(500,{error:'歌词加载失败: '+e.message})})
    return
  }

  // 获取音乐URL列表
  if(pt==='/api/urls'){
    var s=q.source||KEYS[0],sid=q.id||'';
    if(!sid||!SRC[s]) return send(400,{error:'无效参数'});
    var tasks=SRC[s].urls(sid);
    Promise.all(tasks.map(function(t){
      return t.u.then(function(url){return{key:t.key,name:t.n,url:url}})
        .catch(function(e){return{key:t.key,name:t.n,url:null,error:e.message}})
    }))
    .then(function(r){send(200,{id:sid,source:s,urls:r.filter(function(x){return x.url&&x.url.startsWith('http')})})})
    .catch(function(e){send(500,{error:'URL获取失败: '+e.message})})
    return
  }

  send(404,{error:'接口不存在'});
}).listen(PORT,function(){console.log('☀️ 小源启动 → 端口 ' + PORT)});
