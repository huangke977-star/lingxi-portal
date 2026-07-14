export const FALLBACK_PROFILE_BIO = '我懒，我不写';

const profileBioOpenings = [
  '我懒',
  '我高冷',
  '我就是不写',
  '我就喜欢这个范',
  '我今天不营业',
  '我在认真摸鱼',
  '我先保持神秘',
  '我还没想好',
  '我比较随缘',
  '我低调路过',
  '我不太会介绍自己',
  '我把话留给以后',
  '我正在加载中',
  '我暂时只想安静',
  '我喜欢简单一点',
  '我把签名藏起来了',
  '我在等灵感出现',
  '我选择沉默但不缺席',
];

const profileBioEndings = [
  '所以我不写。',
  '但我会常来看看。',
  '就先这样吧。',
  '这句话已经很努力了。',
  '等我想到了再补。',
  '保持一点神秘感也不错。',
  '介绍越短，空间越大。',
  '此处应该有点个性。',
  '先把存在感放在这里。',
  '文字少一点，心情轻一点。',
  '今天的自我介绍额度用完了。',
  '我觉得这样刚刚好。',
  '不解释也是一种风格。',
  '慢慢熟了就知道了。',
  '把更多内容留给下一次。',
  '反正你已经看到我了。',
];

export const DEFAULT_PROFILE_BIOS = profileBioOpenings.flatMap((opening) =>
  profileBioEndings.map((ending) => `${opening}，${ending}`),
);

export function pickDefaultProfileBio(): string {
  return DEFAULT_PROFILE_BIOS[Math.floor(Math.random() * DEFAULT_PROFILE_BIOS.length)] ?? FALLBACK_PROFILE_BIO;
}
