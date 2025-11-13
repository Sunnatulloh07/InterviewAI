import { registerAs } from '@nestjs/config';

export const stripeConfig = registerAs('stripe', () => ({
  apiKey: process.env.STRIPE_API_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  plans: {
    pro: {
      priceId: process.env.STRIPE_PRO_PRICE_ID,
      productId: process.env.STRIPE_PRO_PRODUCT_ID,
    },
    elite: {
      priceId: process.env.STRIPE_ELITE_PRICE_ID,
      productId: process.env.STRIPE_ELITE_PRODUCT_ID,
    },
  },
  successUrl: process.env.STRIPE_SUCCESS_URL || 'http://localhost:5173/payment/success',
  cancelUrl: process.env.STRIPE_CANCEL_URL || 'http://localhost:5173/payment/cancel',
}));
