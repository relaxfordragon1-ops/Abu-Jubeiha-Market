export interface PaymentAccount {
  value: string;
  label: string;
  account: string;
  holder: string;
}

export const PAYMENT_ACCOUNTS: PaymentAccount[] = [
  {
    value: 'بنكك',
    label: 'تطبيق بنكك (Bankak)',
    account: '7560865',
    holder: 'عبد الله نواي علي احمد',
  },
  {
    value: 'فوري',
    label: 'فوري (Fawry)',
    account: '52057815',
    holder: 'علي نواي علي احمد',
  },
  {
    value: 'ماي كاشي',
    label: 'ماي كاشي (MyCashi)',
    account: '402008803',
    holder: 'علي نواي',
  },
  {
    value: 'دفع مباشر للإدارة',
    label: 'دفع مباشر لإدارة السوق في أبو جبيهة',
    account: '',
    holder: '',
  },
];
