// Sanitized synthetic replays of formats covered by test-holy(.mjs), test-holy-robust
// and test-holy-versions. These are NOT downloaded pages or physical playback evidence.
// Every title/id/token is a placeholder; no playable media, signatures or credentials.
const flight = value => '<script>self.__next_f.push([1,' + JSON.stringify(value) + '])</script>';
const frame64 = url => Buffer.from('<iframe src="' + url + '"></iframe>').toString('base64');
const short = url => 'https://embedshortener.co/e/fixture.' + Buffer.from(JSON.stringify({link:Buffer.from(url).toString('base64')})).toString('base64url') + '.fixture';
const ep = 'https://doramasflix.io/capitulos/fixture-1x1';
const flixLanguages = '"langs":[{"name":"Coreano","code":"ko","code_flix":"13109"},{"name":"Latino","code":"es","code_flix":"38"}]';
const flixLinks = [
 {server:'8309',lang:'38',link:short('https://streamtape.com/e/fixture-spanish')},
 {server:'38585',lang:'38',link:short('https://flaswish.com/e/fixture-spanish')},
 {server:'38585',lang:'13109',link:short('https://flaswish.com/e/fixture-korean'),subtitles:[{language_code:'es'}]},
 {server:'99999',lang:'38',link:short('https://ignored.example/fixture')}
];
export const SOURCE_CONTRACTS = [
 {source:'cuevana',identity:{"title":"Contrato Cuevana","kind":"movie","url":"https://cuevana3c.pro/pelicula/fixture"},declaredLanguage:null, home:'<section class="home-movies"><li class="TPostMv"><a href="https://cuevana3c.pro/pelicula/fixture"><img src="https://image.tmdb.org/t/p/w300/fixture.jpg"><h2 class="Title">Contrato Cuevana</h2></a></li></section>',
  choice:{kind:'dub',version:'latino'}, expected:{url:'https://tungtungsahur.cuevana3c.pro/?fixture=latino-a&pops=false', referrer:'https://cuevana3c.pro/pelicula/fixture',alternatives:['https://tungtungsahur.cuevana3c.pro/?fixture=latino-b&pops=false'],versionKind:'dub',version:'latino'},
  responses:[
   {url:'https://cuevana3c.pro/pelicula/fixture',body:'<li class="tab-video-item"><div class="tab-item-name">Latino<div>HD</div></div><li data-server="https://tungtungsahur.cuevana3c.pro/?fixture=latino-a"></li><li data-server="https://tungtungsahur.cuevana3c.pro/?fixture=latino-b"></li><li data-server="javascript:alert(1)"></li><li class="tab-video-item"><div class="tab-item-name">Subtitulado<div>HD</div></div><li data-server="https://tungtungsahur.cuevana3c.pro/?fixture=sub"></li>'}
  ]},
 {source:'repelishd',identity:{"title":"Contrato RePelis","kind":"movie","url":"https://repelishd.blog/ver-pelicula/1-fixture.html"},declaredLanguage:"Latino", home:'<h2>Últimas Películas Agregadas</h2><article class="item movies"><a href="https://repelishd.blog/ver-pelicula/1-fixture.html"><img src="/fixture.jpg"></a><h3>Contrato RePelis</h3><span>2026</span></article><h2>Otra fila</h2>',
  expected:{url:'https://mxdrop.to/e/fixture-latino',referrer:'https://playlatinsrc.co/movie/tt0000001',alternatives:['https://doodstream.com/e/fixture-latino'],version:'latino'},
  responses:[
   {url:'https://repelishd.blog/ver-pelicula/1-fixture.html',body:"<script>var imdb = 'tt0000001';</script>"},
   {url:'https://playlatinsrc.co/movie/tt0000001',referrer:'https://repelishd.blog/ver-pelicula/1-fixture.html',body:'<script>token: "fixture-only"</script>'},
   {url:'https://playlatinsrc.co/api/embed-links',method:'POST',referrer:'https://playlatinsrc.co/movie/tt0000001',requestJSON:{type:'movie',id:'tt0000001',token:'fixture-only'},body:JSON.stringify({sources:[
    {url:'https://dr0pstream.com/e/unsafe',version:'latino'},
    {url:'javascript:alert(1)',version:'latino'},
    {url:'https://doodstream.com/e/fixture-latino',version:'latino'},
    {url:'https://mxdrop.to/e/fixture-latino',version:'latino'}]})}
  ]},
 {source:'jkanime',identity:{"title":"Contrato JK","kind":"anime","episode":1,"url":"https://jkanime.net/fixture/1/"},declaredLanguage:"Subtitulado", home:'<div id="animes" role="tabpanel"><div class="card fixture"><a href="https://jkanime.net/fixture/1/"><img src="https://cdn.jkdesa.com/fixture.jpg"><h5 class="card-title">Contrato JK</h5></a></div></div><div class="tab-pane"></div>',
  choice:{kind:'dub',version:'3'},expected:{url:'https://jkanime.net/jkplayer/um?fixture=dub',referrer:'https://jkanime.net/fixture/1/',alternatives:['https://jkanime.net/jkplayer/jk?fixture=dub'],versionKind:'dub',version:'3'},
  responses:[{url:'https://jkanime.net/fixture/1/',body:'<option value="1">Japones Sub. Español</option><option value="3">Espanol latino</option><script>video[0] = \'<iframe src="https://jkanime.net/jkplayer/um?fixture=sub"></iframe>\';video[1] = \'<iframe src="https://jkanime.net/jkplayer/um?fixture=dub"></iframe>\';video[2] = \'<iframe src="https://jkanime.net/jkplayer/jk?fixture=dub"></iframe>\';video[3] = \'<iframe src="https://ads.example/not-player"></iframe>\';</script><a data-id="0" class="servers lg_1"></a><a data-id="1" class="servers lg_3"></a><a data-id="2" class="servers lg_3"></a>'}]},
 {source:'animeyt',identity:{"title":"Contrato AnimeYT","kind":"anime","episode":1,"url":"https://animeyt.cc/1/anime/fixture-capitulo-1/"},declaredLanguage:"Subtitulado",home:'<article class="aniyt-episode-card"><a class="aniyt-episode-media" href="https://animeyt.cc/1/anime/fixture-capitulo-1/" aria-label="Ver Contrato AnimeYT, episodio 1"><img src="https://animeyt.cc/fixture.jpg"></a></article>',
  expected:{url:'https://video.example/fixture.mp4',referrer:'https://mytsumi.com/container.php?id=fixture&only=SUB&open=1',alternatives:['https://ok.ru/videoembed/11?autoplay=1','https://bysejikuar.com/e/fixture','https://mytsumi.com/container.php?id=fixture&only=SUB&open=1']},
  responses:[
   {url:'https://animeyt.cc/1/anime/fixture-capitulo-1/',body:'<iframe src="https://mytsumi.com/container.php?id=fixture&amp;only=SUB"></iframe>'},
   {url:'https://mytsumi.com/container.php?id=fixture&only=SUB&open=1',referrer:'https://animeyt.cc/1/anime/fixture-capitulo-1/',body:'<button data-player-url="https://mega.nz/embed/fixture" data-player-kind="iframe" data-player-label="MEGA"></button><button data-player-url="javascript:alert(1)" data-player-kind="video" data-player-label="fake"></button><button data-player-url="https://bysejikuar.com/e/fixture" data-player-kind="iframe" data-player-label="Byse"></button><button data-player-url="https://ok.ru/videoembed/11" data-player-kind="iframe" data-player-label="OK"></button><button data-player-url="https://video.example/fixture.mp4" data-player-kind="video" data-player-label="Direct"></button>'}
  ]},
 {source:'doramasflix',identity:{"title":"Contrato Flix","kind":"dorama","episode":1,"url":"https://doramasflix.io/capitulos/fixture-1x1"},declaredLanguage:null,home:flight('2a:{"__typename":"EpisodeMin","slug":"fixture-1x1","name":"Contrato Flix 1x1","still_path":"/fixture.jpg"}'),
  choice:{kind:'dub',version:'38'},expected:{url:'https://streamtape.com/e/fixture-spanish',referrer:ep,alternatives:['https://flaswish.com/e/fixture-spanish'],version:'38',versionKind:'dub'},
  responses:[
   {url:ep,body:'<script src="/_next/static/chunks/fixture.js"></script>'+flight('2a:{"episode":{"_id":"aaaaaaaaaaaaaaaaaaaaaaaa"}}'+flixLanguages)},
   {url:'https://doramasflix.io/_next/static/chunks/fixture.js',body:'createServerReference)("40bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",a.callServer,void 0,a.findSourceMapURL,"getEpisodeLinks")'},
   {url:ep,method:'POST',requestJSON:[{episode_id:'aaaaaaaaaaaaaaaaaaaaaaaa'}],body:'0:{"a":"$@1"}\n1:'+JSON.stringify(flixLinks)}
  ]},
 {source:'doramasmp4',identity:{"title":"Contrato MP4","kind":"dorama","badge":"Cap 1","url":"https://doramasmp4.cyou/cap/fixture-capitulo-1/"},declaredLanguage:"Subtitulado",home:'Últimos Estrenos<article class="bs"><a href="https://doramasmp4.cyou/cap/fixture-capitulo-1/" title="Contrato MP4 Capitulo 1"><img src="https://doramasmp4.cyou/fixture.jpg"><div class="tt">Contrato MP4</div></a></article>Más populares',
  expected:{url:'https://ok.ru/videoembed/12?autoplay=1',referrer:'https://doramasmp4.cyou/cap/fixture-capitulo-1/',alternatives:['https://voe.sx/e/fixture','https://vkvideo.ru/video_ext.php?id=fixture']},
  responses:[
   {url:'https://doramasmp4.cyou/cap/fixture-capitulo-1/',body:'<option value="'+frame64('javascript:alert(1)')+'">No</option><option value="'+frame64('https://pkaa.top/embed.php?id=fixture')+'">Multi</option>'},
   {url:'https://pkaa.top/embed.php?id=fixture',referrer:'https://doramasmp4.cyou/cap/fixture-capitulo-1/',body:"go_to_player('https://vkvideo.ru/video_ext.php?id=fixture');go_to_player('https://voe.sx/e/fixture');go_to_player('https://ok.ru/videoembed/12');"}
  ]},
 {source:'asialiveaction',identity:{"title":"Contrato ALA","kind":"dorama","episode":1,"url":"https://asialiveaction.com/e/1/fixture/1/"},declaredLanguage:null,home:'Últimos Episodios</h3><li><a href="https://asialiveaction.com/e/1/fixture/1/"><figure><img src="https://image.tmdb.org/t/p/w533_and_h300_multi_faces/fixture.jpg"></figure><h5>Contrato ALA<span>1</span></h5></a></li></section>',
  expected:{url:'https://ok.ru/videoembed/13?autoplay=1',referrer:'https://asialiveaction.com/e/1/fixture/1/',alternatives:['https://bysejikuar.com/e/fixture','https://vkvideo.ru/video_ext.php?id=fixture']},
  responses:[{url:'https://asialiveaction.com/e/1/fixture/1/',body:'<script>var allVideos = '+JSON.stringify({fixture:[['VK','https://vkvideo.ru/video_ext.php?id=fixture'],['FM','https://bysejikuar.com/e/fixture'],['OK','https://ok.ru/videoembed/13'],['bad','http://insecure.example/fixture'],['bad','javascript:alert(1)']]})+';</script>'}]},
 {source:'onlyflix',identity:{"title":"Contrato OnlyFlix","kind":"movie","url":"https://onlyflix.to/fixture/"},declaredLanguage:"Inglés",home:'<article class="of-title-card-v2" data-title="Contrato OnlyFlix" data-url="https://onlyflix.to/fixture/" data-year="2026"><a class="x"></a>',
  expected:{url:'https://cdn.example/embed/1',referrer:'https://onlyflix.to/fixture/',alternatives:['https://vid.example/embed/1']},
  responses:[
   {url:'https://onlyflix.to/fixture/',body:'<div class="player-frame" data-player-nonce="fixture" data-player-post-id="1" data-player-content-type="movie"></div>'},
   {url:'https://onlyflix.to/wp-admin/admin-ajax.php',method:'POST',referrer:'https://onlyflix.to/fixture/',body:JSON.stringify({data:{players:[{url:'https://cdn.example/embed/1',language:'EN'},{url:'javascript:alert(1)',language:'EN'},{url:'https://vid.example/embed/1',language:''}]}})}
  ]},
];
