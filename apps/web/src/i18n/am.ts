import type { Messages } from './en.ts';

// Draft Amharic copy — needs review by a native speaker before launch.
export const am: Messages = {
  common: {
    loading: 'በመጫን ላይ…',
    retry: 'እንደገና ይሞክሩ',
    back: 'ተመለስ',
    continue: 'ቀጥል',
    cancel: 'ሰርዝ',
    language: 'ቋንቋ',
  },
  errors: {
    genericTitle: 'የሆነ ችግር ተፈጥሯል',
    offlineTitle: 'ከኢንተርኔት ጋር አልተገናኙም',
    wrongAreaTitle: 'ይህ ክፍል ለመለያዎ አይደለም',
    wrongAreaBody: 'ፈቃድ ባለው መለያ ይግቡ ወይም ወደ መተግበሪያው ይመለሱ።',
  },
  auth: {
    phoneLabel: 'ስልክ ቁጥር',
    phonePlaceholder: '91 123 4567',
    phoneHint: 'የኢትዮ ቴሌኮም ወይም የሳፋሪኮም ቁጥር',
    sendCode: 'ኮድ ላክ',
    smsNote: 'ባለ 6 አሃዝ ኮድ በኤስኤምኤስ እንልክልዎታለን።',
    phoneErrors: {
      empty: 'ስልክ ቁጥርዎን ያስገቡ።',
      invalid_characters: 'ቁጥሮችን ብቻ ይጠቀሙ።',
      invalid_format: 'ባለ 9 አሃዝ የኢትዮጵያ ሞባይል ቁጥር ያስገቡ፤ ለምሳሌ 91 123 4567።',
      not_mobile: 'በ9 ወይም በ7 የሚጀምር የሞባይል ቁጥር ይጠቀሙ።',
    },
    customer: {
      title: 'በአዲስ አበባ ውስጥ እቃ ይላኩ',
      subtitle: 'በስልክ ቁጥርዎ ይግቡ ወይም መለያ ይፍጠሩ።',
    },
    rider: {
      title: 'የአሽከርካሪ መግቢያ',
      subtitle: 'የተመዘገቡበትን ስልክ ቁጥር ይጠቀሙ።',
      apply: 'ከእኛ ጋር መስራት ይፈልጋሉ? ያመልክቱ',
    },
    admin: {
      title: 'የኦፕሬሽን መግቢያ',
      subtitle: 'ለሰራተኞች ብቻ።',
    },
  },
  nav: {
    home: 'መነሻ',
    deliveries: 'ትዕዛዞች',
    account: 'መለያ',
    jobs: 'ስራዎች',
    earnings: 'ገቢ',
    liveOps: 'የቀጥታ ክትትል',
    riders: 'አሽከርካሪዎች',
    reconciliation: 'ሂሳብ ማስታረቅ',
    pricing: 'ዋጋ',
    users: 'ተጠቃሚዎች',
  },
};
