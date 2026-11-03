/**
 * Curated Chinese -> English query dictionary.
 * Value syntax: alternatives separated by `|` (OR); words inside one alternative are ANDed.
 * e.g. '二维码': 'qr code|qrcode' means (qr AND code) OR qrcode.
 */

/** Category slug -> Chinese aliases; the first alias is the display name. */
export const CATEGORY_ZH: Record<string, string[]> = {
  'animals': ['动物', '宠物'],
  'anime': ['动漫', '动画'],
  'anti-malware': ['反恶意软件', '杀毒', '恶意软件'],
  'art-design': ['艺术与设计', '艺术设计', '艺术', '设计'],
  'authentication-authorization': ['认证与授权', '身份认证', '认证', '授权'],
  'blockchain': ['区块链'],
  'books': ['书籍', '图书'],
  'business': ['商业', '企业'],
  'calendar': ['日历'],
  'cloud-storage-file-sharing': ['云存储与文件共享', '云存储', '文件共享'],
  'continuous-integration': ['持续集成'],
  'cryptocurrency': ['加密货币', '数字货币'],
  'currency-exchange': ['汇率', '货币兑换', '外汇'],
  'data-validation': ['数据验证', '数据校验'],
  'development': ['开发', '开发者', '开发工具'],
  'dictionaries': ['词典', '字典'],
  'documents-productivity': ['文档与效率', '文档', '办公', '效率'],
  'email': ['邮箱', '邮件'],
  'entertainment': ['娱乐'],
  'environment': ['环境', '环保'],
  'events': ['活动', '事件'],
  'finance': ['金融', '财经'],
  'food-drink': ['美食饮品', '食物', '饮品', '美食'],
  'games-comics': ['游戏与漫画', '游戏', '漫画'],
  'geocoding': ['地理编码', '地图', '地理'],
  'government': ['政府', '政务'],
  'health': ['健康', '医疗'],
  'jobs': ['招聘', '工作', '求职'],
  'machine-learning': ['机器学习', '人工智能'],
  'music': ['音乐'],
  'news': ['新闻', '资讯'],
  'open-data': ['开放数据', '公开数据'],
  'open-source-projects': ['开源项目', '开源'],
  'patent': ['专利'],
  'personality': ['性格', '人格', '趣味'],
  'phone': ['电话', '手机号', '手机'],
  'photography': ['摄影', '图片', '照片'],
  'programming': ['编程', '代码'],
  'science-math': ['科学与数学', '科学', '数学'],
  'security': ['安全'],
  'shopping': ['购物', '电商'],
  'social': ['社交', '社交媒体'],
  'sports-fitness': ['体育与健身', '体育', '健身', '运动'],
  'test-data': ['测试数据', '模拟数据', '假数据'],
  'text-analysis': ['文本分析'],
  'tracking': ['追踪', '物流', '快递'],
  'transportation': ['交通', '出行'],
  'url-shorteners': ['短链接', '短网址'],
  'vehicle': ['车辆', '汽车'],
  'video': ['视频'],
  'weather': ['天气', '气象'],
}

/** Words that carry no meaning for ranking; silently dropped. */
export const ZH_STOPWORDS: string[] = [
  '免费', '接口', '的', '一个', '一些', '查询', '获取', '相关', '有哪些', '哪些', '推荐', '请问', '如何', '怎么',
  '搜索', '查找', '可以', '我', '想', '要', '和', '与', '及', '公共', '好用', '有没有', '有',
]

export const EN_STOPWORDS: string[] = [
  'api', 'apis', 'free', 'public', 'the', 'a', 'an', 'of', 'for', 'to', 'and', 'or', 'in', 'on', 'with', 'by',
  'is', 'are', 'that', 'this', 'any', 'some', 'best', 'good', 'rest', 'restful', 'endpoint', 'endpoints',
]

const WORDS: Record<string, string> = {
  // weather & environment
  '气候': 'weather|climate', '预报': 'forecast', '空气质量': 'air quality|pollution', '污染': 'pollution',
  '地震': 'earthquake', '能源': 'energy', '碳排放': 'carbon', '碳': 'carbon',
  // geo
  '地理编码': 'geocoding', '地址': 'address|geocoding', '定位': 'geolocation|location|ip',
  '位置': 'geolocation|location', '经纬度': 'geocoding|coordinates', '邮编': 'postal|zip|postcode',
  '国家': 'countries|country', '城市': 'cities|city', '时区': 'timezone|time zone',
  '地图服务': 'maps|geocoding', '坐标': 'coordinates|geocoding',
  // language
  '翻译': 'translation|translate', '语言': 'language|languages', '单词': 'words|word|dictionary',
  '语法': 'grammar', '拼写检查': 'spell|spelling|grammar', '诗': 'poetry|poems', '诗歌': 'poetry|poems',
  '名言': 'quotes|quote', '引用': 'quotes|citation',
  // money
  '股票': 'stock|stocks', '证券': 'stock|securities', '基金': 'finance|fund', '银行': 'bank|banking',
  '支付': 'payment|payments', '保险': 'insurance', '税': 'tax', '经济': 'economy|economic',
  '货币': 'currency', '兑换': 'exchange', '汇率': 'currency exchange|exchange rates',
  '价格': 'price|prices', '优惠': 'coupon|deals|discount', '商品': 'products|product|shopping',
  '加密货币': 'cryptocurrency|crypto', '数字货币': 'cryptocurrency|crypto', '比特币': 'bitcoin|cryptocurrency',
  '以太坊': 'ethereum', '币价': 'crypto|price',
  // media
  '文章': 'article|articles', '博客': 'blog', '电影': 'movie|movies|film', '影视': 'movie|movies|tv',
  '电视': 'tv|television', '电视剧': 'tv|television|shows', '歌曲': 'music|songs', '歌词': 'lyrics',
  '图像': 'image|images', '壁纸': 'wallpaper', '图标': 'icons|icon', '头像': 'avatar|avatars', '表情': 'emoji',
  '表情包': 'emoji|gif|memes', '直播': 'live stream|streaming|video', '播客': 'podcast|podcasts', '小说': 'books|novel',
  '圣经': 'bible', '颜色': 'color|colors', '字体': 'fonts|font', '博物馆': 'museum|art', '摄影师': 'photography',
  // communication
  '邮箱': 'email', '邮件': 'email|mail', '短信': 'sms', '手机号': 'phone', '电话': 'phone|telephone',
  '验证码': 'otp|verification|sms', '二维码': 'qr code|qrcode', '条形码': 'barcode', '条码': 'barcode',
  // fun
  '动漫': 'anime|manga', '漫画': 'comics|manga|comic', '动画': 'anime|animation', '游戏': 'games|game|gaming',
  '棋': 'chess', '卡牌': 'cards|card game', '宝可梦': 'pokemon', '漫威': 'marvel', '星球大战': 'star wars',
  '哈利波特': 'harry potter', '我的世界': 'minecraft', '笑话': 'jokes|joke', '冷知识': 'trivia|facts',
  '趣味': 'fun|jokes|trivia', '星座': 'horoscope|astrology', '占卜': 'astrology|horoscope',
  '性格测试': 'personality',
  // sports & health
  '足球': 'soccer|football', '篮球': 'basketball', '棒球': 'baseball', '赛车': 'racing|formula', '运动': 'sports|fitness',
  '医学': 'medical|medicine', '药品': 'drug|drugs|medicine', '药': 'drug|drugs|medicine',
  '疫情': 'covid|covid-19|coronavirus', '营养': 'nutrition|food', '医院': 'hospital|health',
  // government & data
  '数据集': 'dataset|datasets|open data', '统计': 'statistics', '人口': 'population|demographics',
  '选举': 'election|elections|government', '法律': 'law|legal', '法规': 'law|legal',
  // ML
  '深度学习': 'deep learning|machine learning', '自然语言': 'natural language|nlp',
  '图像识别': 'image recognition|computer vision|machine learning', '人脸': 'face|facial',
  '语音': 'speech|voice', '语音合成': 'text to speech|tts|speech', '文字识别': 'ocr|text recognition',
  '聊天机器人': 'chatbot|bot', '大模型': 'llm|language model|ai', '模型': 'model|models',
  // space & science
  '天文': 'astronomy|space', '太空': 'space', '航天': 'space|nasa', '火箭': 'rocket|spacex|space',
  '星球': 'planets|space', '行星': 'planets|space', '卫星': 'satellite|space', '科学': 'science',
  '数学': 'math|mathematics', '化学': 'chemistry', '物理': 'physics', '生物': 'biology', '元素': 'periodic table|elements',
  '单位转换': 'unit conversion|units|convert', '转换': 'convert|conversion', '计算': 'calculator|math',
  // transport & travel
  '公交': 'transit|bus', '地铁': 'transit|metro|subway', '航班': 'flight|flights|airline', '飞机': 'flights|aircraft|aviation',
  '机场': 'airport|airports', '火车': 'train|rail|railway', '铁路': 'rail|railway|train', '船': 'ship|vessel|maritime',
  '旅游': 'travel|tourism', '旅行': 'travel|tourism', '酒店': 'hotel|hotels|travel', '地铁线路': 'transit|metro',
  // security
  '漏洞': 'vulnerability|vulnerabilities|cve|security', '病毒': 'virus|malware', '钓鱼': 'phishing',
  '密码': 'password|passwords', '加密': 'encryption|crypto', '哈希': 'hash', '泄露': 'breach|leak|security',
  // test / random
  '假数据': 'fake data|mock|test data', '模拟数据': 'mock data|fake|test data', '随机': 'random',
  '随机数': 'random', '占位': 'placeholder',
  // text
  '文本': 'text', '情感分析': 'sentiment|text analysis', '情感': 'sentiment', '分词': 'tokenization|nlp',
  '关键词': 'keywords|keyword', '摘要': 'summary|summarization|text analysis',
  // web
  '链接': 'url|link|links', '网址': 'url', '域名': 'domain|domains|whois', '短网址': 'url shortener|shortener',
  '网页': 'web page|website', '截图': 'screenshot', '爬虫': 'scraping|scraper|web scraping',
  // food
  '菜谱': 'recipe|recipes|food', '食谱': 'recipe|recipes|food', '食物': 'food|recipe|recipes',
  '饮料': 'drink|drinks|beverage', '咖啡': 'coffee', '啤酒': 'beer|brewery', '鸡尾酒': 'cocktail|cocktails',
  '葡萄酒': 'wine', '酒': 'wine|beer|cocktail|drink', '餐厅': 'restaurant|restaurants|food',
  // animals & vehicles
  '宠物': 'pets|pet|animals|dog|cat', '猫': 'cat|cats', '狗': 'dog|dogs', '鸟': 'bird|birds', '鱼': 'fish',
  '车': 'car|vehicle', '车牌': 'license plate|vehicle', '汽车': 'vehicle|vehicles|car|cars',
  // calendar & docs
  '节假日': 'holiday|holidays|calendar', '假期': 'holidays|holiday', '节日': 'holiday|holidays',
  '日期': 'date|calendar', '时间': 'time|date', '文件': 'file|files|documents', '笔记': 'notes|note',
  '待办': 'todo|task', '表格': 'spreadsheet',
  // dev
  '开发者': 'development|developer', '代码': 'code|programming', '部署': 'deploy|deployment|hosting',
  '托管': 'hosting', '云': 'cloud', '数据库': 'database', '监控': 'monitoring|uptime', '日志': 'logging|logs',
  '测试': 'test|testing', '版本': 'version|versions', '包管理': 'package|packages', '容器': 'container|docker',
  // jobs, business, social
  '求职': 'jobs|job', '简历': 'resume', '商标': 'trademark|patent', '营销': 'marketing', '公司': 'company|companies|business',
  '社交媒体': 'social media|social', '推特': 'twitter', '论坛': 'forum', '评论': 'comments|reviews',
  '电商': 'ecommerce|shopping', '追踪': 'tracking|track', '快递': 'shipping|tracking|package|parcel',
  '物流': 'shipping|tracking|logistics', '包裹': 'package|parcel|tracking', '活动': 'events|event',
  '演出': 'events|concerts', '票务': 'tickets|events', '会议': 'conference|events', '开源': 'open source',
  '登录': 'login|authentication|oauth', '身份': 'identity|authentication', '艺术': 'art', '设计': 'design',
  '环境': 'environment', '商业': 'business', '企业': 'business|company|companies',
  // misc one-offs
  '开放数据': 'open data', '政府数据': 'government|open data', '实时': 'real time|realtime', '历史': 'history|historical',
}

function categoryWords(name: string): string {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && w !== 'and').join(' ')
}

/** Pre-index of explicit entries by Chinese key. */
export const ZH_DICT: Map<string, string> = (() => {
  const m = new Map<string, string>()
  const base: Record<string, string> = {
    // Specific mappings required by the contract; kept first so they win over generated category entries.
    '天气': 'weather', '气象': 'weather', '地图': 'maps|map|geocoding', '翻译': 'translation|translate',
    '金融': 'finance|financial|stock', '新闻': 'news', '音乐': 'music', '图片': 'images|photos|photography|image',
    '照片': 'photos|photography', '摄影': 'photography', '视频': 'video|videos', '书籍': 'books|book', '图书': 'books|book',
    '体育': 'sports|sport', '健身': 'fitness|workout', '健康': 'health', '医疗': 'health|medical|healthcare',
    '政府': 'government', '机器学习': 'machine learning', '人工智能': 'artificial intelligence|machine learning|ai',
    '交通': 'transportation|transit', '安全': 'security', '测试数据': 'test data|fake data|mock',
    '文本分析': 'text analysis|nlp', '短链接': 'url shortener|url shorteners|shortener', '词典': 'dictionaries|dictionary',
    '字典': 'dictionary|dictionaries', '动物': 'animals|animal', '开发': 'development|developer', '编程': 'programming|code',
    '汇率': 'currency exchange|exchange rates', '邮件': 'email|mail', '日历': 'calendar', '专利': 'patent|patents',
    '招聘': 'jobs|job|hiring', '工作': 'jobs|job', '游戏': 'games|game|gaming', '区块链': 'blockchain',
    '购物': 'shopping|ecommerce', '社交': 'social', '娱乐': 'entertainment', '手机': 'phone|mobile',
    '认证': 'authentication|auth', '授权': 'authorization|oauth', '追踪': 'tracking|track',
    '车辆': 'vehicle|vehicles|car', '性格': 'personality', '人格': 'personality', '事件': 'events|event',
    '云存储': 'cloud storage|storage', '文件共享': 'file sharing|cloud storage', '持续集成': 'continuous integration|ci',
    '数据验证': 'data validation|validation|validate', '数据校验': 'data validation|validation|validate',
    '文档': 'documents|document', '办公': 'productivity|documents', '效率': 'productivity', '环保': 'environment',
    '恶意软件': 'malware', '杀毒': 'malware|antivirus', '反恶意软件': 'malware|anti-malware',
    '开发工具': 'development|developer|tools', '公开数据': 'open data', '政务': 'government', '财经': 'finance|financial|economy',
    '艺术设计': 'art design', '身份认证': 'authentication|identity|auth', '文件': 'file|files|documents',
  }
  for (const [k, v] of Object.entries(base)) m.set(k, v)
  for (const [k, v] of Object.entries(WORDS)) if (!m.has(k)) m.set(k, v)
  return m
})()

/** Add the long-form category aliases (e.g. '艺术与设计' -> 'art design') using the real category names. */
export function dictionaryFor(categoryNames: Iterable<{ name: string; slug: string }>): Map<string, string> {
  const dict = new Map(ZH_DICT)
  for (const { name, slug } of categoryNames) {
    for (const alias of CATEGORY_ZH[slug] ?? []) {
      if (!dict.has(alias)) dict.set(alias, categoryWords(name))
    }
  }
  return dict
}

export interface ZhSegmentation {
  /** Each group is a list of alternatives; each alternative is a list of words (all required). */
  groups: string[][][]
  unknown: string[]
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu

export function parseAlternatives(spec: string): string[][] {
  return spec.split('|').map(alt => alt.trim().split(/\s+/).filter(Boolean)).filter(a => a.length > 0)
}

/** Longest-match segmentation of the CJK runs in a query. */
export function segmentCjk(text: string, dict: Map<string, string>): ZhSegmentation {
  const groups: string[][][] = []
  const unknown: string[] = []
  const stop = new Set(ZH_STOPWORDS)
  let maxLen = 1
  for (const k of dict.keys()) maxLen = Math.max(maxLen, Array.from(k).length)
  for (const k of stop) maxLen = Math.max(maxLen, Array.from(k).length)

  for (const run of text.match(CJK) ?? []) {
    const chars = Array.from(run)
    let pending = ''
    const flush = () => {
      if (pending) unknown.push(pending)
      pending = ''
    }
    for (let i = 0; i < chars.length;) {
      let matched = 0
      for (let len = Math.min(maxLen, chars.length - i); len >= 1; len--) {
        const key = chars.slice(i, i + len).join('')
        if (dict.has(key) || stop.has(key)) {
          flush()
          if (!stop.has(key) || dict.has(key)) {
            // A key present in both lists is treated as a real term.
            if (dict.has(key)) groups.push(parseAlternatives(dict.get(key)!))
          }
          matched = len
          break
        }
      }
      if (matched) i += matched
      else {
        pending += chars[i]
        i++
      }
    }
    flush()
  }
  return { groups, unknown }
}
