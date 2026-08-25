type LocalizedMotto = readonly [chinese: string, english: string];

const MOTTO_OPENINGS: readonly LocalizedMotto[] = [
  ["把今天过得认真一点", "Give today your full attention"],
  ["慢一点也没关系", "It is all right to move slowly"],
  ["真正的成长常常很安静", "Real growth is often quiet"],
  ["保持好奇，也保持耐心", "Stay curious and patient"],
  ["每一次小小的坚持都算数", "Every small act of persistence counts"],
  ["允许自己从不完美开始", "Let yourself begin before you are perfect"],
  ["向前走时，也别忘了照顾自己", "Take care of yourself while moving forward"],
  ["答案会在行动里逐渐清晰", "Action will make the answer clearer"],
  ["把注意力放回能改变的事情", "Bring your focus back to what you can change"],
  ["日子需要热爱，也需要节奏", "Life needs both passion and rhythm"],
  ["你的步伐不必与别人一致", "Your pace does not need to match anyone else's"],
  ["那些看似普通的积累终会发光", "Ordinary effort will shine in time"],
  ["先相信自己值得更好的生活", "First believe you deserve a better life"],
  ["认真生活的人自带光芒", "People who live earnestly carry their own light"],
  ["沉住气，时间会给出回响", "Stay steady and let time answer"],
  ["别低估重复一件小事的力量", "Do not underestimate the power of small repetition"],
  ["清醒地选择，温柔地坚持", "Choose clearly and persist gently"],
  ["生活不会辜负每一份用心", "Life does not waste sincere effort"],
  ["把复杂的事拆成简单的一步", "Break a hard thing into one simple step"],
  ["每个清晨都是一次重新出发", "Every morning is a fresh start"],
  ["不急着证明，也不停止成长", "Do not rush to prove yourself or stop growing"],
  ["在自己的节奏里稳稳前进", "Move steadily at your own pace"],
  ["心里有方向，脚下就有力量", "A clear direction gives your steps strength"],
  ["给梦想一点时间，也给自己一点耐心", "Give your dreams time and yourself patience"],
  ["专注当下，就是最可靠的前进", "Focusing on today is the surest progress"],
  ["你走过的路都在塑造更好的自己", "Every road you take shapes a better you"],
  ["保持真诚，也保持一点勇敢", "Stay sincere and keep a little courage"],
  ["值得做的事，慢慢做也会抵达", "Good work still gets there when done slowly"],
  ["今天的努力会成为明天的底气", "Today's effort becomes tomorrow's confidence"],
  ["世界很大，先把自己的生活过好", "The world is vast, so first live your own life well"],
  ["愿你有重新开始的勇气", "May you have the courage to begin again"],
  ["平凡的日子也可以被认真点亮", "Ordinary days can be lit by care"],
];

const MOTTO_ENDINGS: readonly LocalizedMotto[] = [
  ["先完成眼前最小的一步", "Start with the smallest step in front of you"],
  ["把能做好的事情认真做好", "Do the things within reach with care"],
  ["让行动替你回答犹豫", "Let action answer your hesitation"],
  ["给自己一个温柔而坚定的回应", "Offer yourself a kind and steady answer"],
  ["今天也比昨天更靠近目标一点", "Get one step closer to your goal than yesterday"],
  ["把耐心留给正在成长的自己", "Save patience for the person you are becoming"],
  ["不必着急，稳稳走就是答案", "There is no need to hurry; steady is enough"],
  ["让每一次尝试都成为新的经验", "Let every attempt become new experience"],
  ["记得为自己的进步留一点掌声", "Remember to applaud your own progress"],
  ["把时间花在真正重要的人和事上", "Spend time on the people and things that matter"],
  ["即使很慢，也不要停下脚步", "Even when it is slow, keep going"],
  ["愿努力有回音，等待有结果", "May effort find an answer and waiting find a result"],
  ["先出发，再一路修正方向", "Set out first, then refine your direction"],
  ["用清醒的头脑守住内心的热爱", "Use a clear mind to protect what you love"],
  ["让好习惯替你积累看得见的改变", "Let good habits build visible change"],
  ["在有限的时间里创造属于自己的意义", "Create your own meaning in the time you have"],
  ["把今天能完成的事留在今天", "Finish what you can today, today"],
  ["走自己的路，也欣赏沿途的风景", "Walk your own path and enjoy its scenery"],
  ["带着热爱前行，也给生活留些余地", "Move with passion and leave room for life"],
  ["允许偶尔停下，但别忘了再次启程", "Pause when needed, then remember to begin again"],
  ["用长期主义对待真正想要的生活", "Treat the life you want with long-term care"],
  ["把难题交给时间，也交给持续的行动", "Give hard problems both time and continued action"],
  ["认真感受当下，也期待下一次相遇", "Feel this moment deeply and welcome the next"],
  ["保持一点锋芒，也保留足够的温柔", "Keep your edge while holding on to kindness"],
  ["让内心安定，脚步自然会更坚定", "Settle your mind and your steps will grow firmer"],
  ["多做一点积累，少给一点焦虑", "Build a little more and give anxiety less room"],
  ["把选择变成行动，把行动变成结果", "Turn choices into action and action into results"],
  ["珍惜每一次能够重新选择的机会", "Value every chance to choose again"],
  ["愿你眼里有光，手上有事，心中有路", "May your eyes hold light, your hands hold work, and your heart hold a path"],
  ["相信那些默默积累的时刻不会白费", "Trust that quiet effort is never wasted"],
  ["先照顾好自己，再拥抱更大的世界", "Care for yourself first, then embrace the wider world"],
  ["愿你自由、清醒，并始终忠于自己", "May you stay free, clear-minded, and true to yourself"],
];

interface MottoAccount {
  id: number;
  username: string;
  createdAt: string;
}

export const ACCOUNT_MOTTO_COUNT = MOTTO_OPENINGS.length * MOTTO_ENDINGS.length;

export function getAccountMotto(account: MottoAccount, locale: "zh-CN" | "en-US"): string {
  const seed = stableHash(`${account.id}:${account.username}:${account.createdAt}`);
  const opening = MOTTO_OPENINGS[seed % MOTTO_OPENINGS.length];
  const endingSeed = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  const ending = MOTTO_ENDINGS[endingSeed % MOTTO_ENDINGS.length];
  const languageIndex = locale === "en-US" ? 1 : 0;

  return locale === "en-US"
    ? `${opening[languageIndex]}. ${ending[languageIndex]}.`
    : `${opening[languageIndex]}，${ending[languageIndex]}。`;
}

function stableHash(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
