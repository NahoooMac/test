export const en = {
  common: {
    loading: 'Loading…',
    retry: 'Try again',
    back: 'Back',
    continue: 'Continue',
    cancel: 'Cancel',
    language: 'Language',
  },
  errors: {
    genericTitle: 'Something went wrong',
    offlineTitle: "You're offline",
    wrongAreaTitle: "This area isn't for your account",
    wrongAreaBody: 'Sign in with an account that has access, or go back to the app.',
  },
  auth: {
    phoneLabel: 'Phone number',
    phonePlaceholder: '91 123 4567',
    phoneHint: 'Ethio Telecom or Safaricom number',
    sendCode: 'Send code',
    smsNote: "We'll text you a 6-digit code. Standard SMS rates may apply.",
    phoneErrors: {
      empty: 'Enter your phone number.',
      invalid_characters: 'Use digits only.',
      invalid_format: 'Enter a 9-digit Ethiopian mobile number, e.g. 91 123 4567.',
      not_mobile: 'Use a mobile number starting with 9 or 7.',
    },
    customer: {
      title: 'Send a parcel across Addis',
      subtitle: 'Sign in or create an account with your phone number.',
    },
    rider: {
      title: 'Rider sign in',
      subtitle: 'Use the phone number you registered with.',
      apply: 'Want to ride with us? Apply',
    },
    admin: {
      title: 'Operations sign in',
      subtitle: 'Staff accounts only.',
    },
  },
  nav: {
    home: 'Home',
    deliveries: 'Deliveries',
    account: 'Account',
    jobs: 'Jobs',
    earnings: 'Earnings',
    liveOps: 'Live operations',
    riders: 'Riders',
    reconciliation: 'Reconciliation',
    pricing: 'Pricing',
    users: 'Users',
  },
};

export type Messages = typeof en;
