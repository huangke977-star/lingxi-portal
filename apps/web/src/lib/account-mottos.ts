const MOTTO_OPENINGS = [
  "把今天过得认真一点",
  "慢一点也没关系",
  "真正的成长常常很安静",
  "保持好奇，也保持耐心",
  "每一次小小的坚持都算数",
  "允许自己从不完美开始",
  "向前走时，也别忘了照顾自己",
  "答案会在行动里逐渐清晰",
  "把注意力放回能改变的事情",
  "日子需要热爱，也需要节奏",
  "你的步伐不必与别人一致",
  "那些看似普通的积累终会发光",
  "先相信自己值得更好的生活",
  "认真生活的人自带光芒",
  "沉住气，时间会给出回响",
  "别低估重复一件小事的力量",
  "清醒地选择，温柔地坚持",
  "生活不会辜负每一份用心",
  "把复杂的事拆成简单的一步",
  "每个清晨都是一次重新出发",
  "不急着证明，也不停止成长",
  "在自己的节奏里稳稳前进",
  "心里有方向，脚下就有力量",
  "给梦想一点时间，也给自己一点耐心",
  "专注当下，就是最可靠的前进",
  "你走过的路都在塑造更好的自己",
  "保持真诚，也保持一点勇敢",
  "值得做的事，慢慢做也会抵达",
  "今天的努力会成为明天的底气",
  "世界很大，先把自己的生活过好",
  "愿你有重新开始的勇气",
  "平凡的日子也可以被认真点亮",
] as const;

const MOTTO_ENDINGS = [
  "先完成眼前最小的一步",
  "把能做好的事情认真做好",
  "让行动替你回答犹豫",
  "给自己一个温柔而坚定的回应",
  "今天也比昨天更靠近目标一点",
  "把耐心留给正在成长的自己",
  "不必着急，稳稳走就是答案",
  "让每一次尝试都成为新的经验",
  "记得为自己的进步留一点掌声",
  "把时间花在真正重要的人和事上",
  "即使很慢，也不要停下脚步",
  "愿努力有回音，等待有结果",
  "先出发，再一路修正方向",
  "用清醒的头脑守住内心的热爱",
  "让好习惯替你积累看得见的改变",
  "在有限的时间里创造属于自己的意义",
  "把今天能完成的事留在今天",
  "走自己的路，也欣赏沿途的风景",
  "带着热爱前行，也给生活留些余地",
  "允许偶尔停下，但别忘了再次启程",
  "用长期主义对待真正想要的生活",
  "把难题交给时间，也交给持续的行动",
  "认真感受当下，也期待下一次相遇",
  "保持一点锋芒，也保留足够的温柔",
  "让内心安定，脚步自然会更坚定",
  "多做一点积累，少给一点焦虑",
  "把选择变成行动，把行动变成结果",
  "珍惜每一次能够重新选择的机会",
  "愿你眼里有光，手上有事，心中有路",
  "相信那些默默积累的时刻不会白费",
  "先照顾好自己，再拥抱更大的世界",
  "愿你自由、清醒，并始终忠于自己",
] as const;

interface MottoAccount {
  id: number;
  username: string;
  createdAt: string;
}

export const ACCOUNT_MOTTO_COUNT = MOTTO_OPENINGS.length * MOTTO_ENDINGS.length;

export function getAccountMotto(account: MottoAccount): string {
  const seed = stableHash(
    `${account.id}:${account.username}:${account.createdAt}`,
  );
  const opening = MOTTO_OPENINGS[seed % MOTTO_OPENINGS.length];
  const endingSeed = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  const ending = MOTTO_ENDINGS[endingSeed % MOTTO_ENDINGS.length];

  return `${opening}，${ending}。`;
}

function stableHash(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
