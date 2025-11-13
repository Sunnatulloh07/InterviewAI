import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Stripe from 'stripe';
import { Subscription, SubscriptionDocument } from './schemas/subscription.schema';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { UsersService } from '../users/users.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly stripe: Stripe | null = null;
  private readonly isStripeEnabled: boolean;

  constructor(
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {
    const stripeApiKey = this.configService.get<string>('STRIPE_API_KEY');
    this.isStripeEnabled = !!stripeApiKey && stripeApiKey.length > 0;

    if (this.isStripeEnabled && stripeApiKey) {
      this.stripe = new Stripe(stripeApiKey, {
        apiVersion: '2025-10-29.clover',
      });
      this.logger.log('Stripe integration enabled');
    } else {
      this.logger.warn('Stripe API key not configured. Payment features will be disabled.');
    }
  }

  async createCheckoutSession(userId: string, planId: string, billingCycle: 'monthly' | 'annual') {
    if (!this.stripe || !this.isStripeEnabled) {
      throw new BadRequestException(
        'Payment features are not available. Please configure Stripe API key in environment variables.',
      );
    }

    const user = await this.usersService.findById(userId);

    let customer: Stripe.Customer;
    if (user.subscription?.stripeCustomerId) {
      customer = (await this.stripe.customers.retrieve(
        user.subscription.stripeCustomerId,
      )) as Stripe.Customer;
    } else {
      customer = await this.stripe.customers.create({
        email: user.email,
        metadata: { userId },
      });
    }

    const priceId = this.getPriceId(planId, billingCycle);

    const session = await this.stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${this.configService.get('FRONTEND_URL')}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.configService.get('FRONTEND_URL')}/payment/cancel`,
      metadata: { userId, planId },
    });

    return { sessionId: session.id, checkoutUrl: session.url };
  }

  async handleWebhook(event: Stripe.Event) {
    if (!this.stripe || !this.isStripeEnabled) {
      this.logger.warn('Webhook received but Stripe not configured');
      return;
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutComplete(event.data.object as Stripe.Checkout.Session);
          break;
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;
        case 'invoice.payment_succeeded':
          await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice);
          break;
      }
    } catch (error) {
      this.logger.error(`Webhook error: ${error.message}`, error.stack);
    }
  }

  private async handleCheckoutComplete(session: Stripe.Checkout.Session) {
    if (!this.stripe) return;

    const userId = session.metadata?.userId as string;
    const subscription = await this.stripe.subscriptions.retrieve(session.subscription as string);

    await this.subscriptionModel.findOneAndUpdate(
      { userId },
      {
        plan: session.metadata?.planId as string,
        status: 'active',
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: subscription.id,
        currentPeriodStart: new Date((subscription as any).current_period_start * 1000),
        currentPeriodEnd: new Date((subscription as any).current_period_end * 1000),
      },
      { upsert: true },
    );

    // Note: User subscription is already updated via subscription model above
    this.logger.log(`Subscription activated for user: ${userId}`);
  }

  private async handleSubscriptionUpdated(subscription: any) {
    await this.subscriptionModel.findOneAndUpdate(
      { stripeSubscriptionId: subscription.id },
      {
        status: subscription.status,
        currentPeriodStart: new Date((subscription as any).current_period_start * 1000),
        currentPeriodEnd: new Date((subscription as any).current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    );
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    await this.subscriptionModel.findOneAndUpdate(
      { stripeSubscriptionId: subscription.id },
      { status: 'canceled' },
    );
  }

  private async handlePaymentSucceeded(invoice: Stripe.Invoice) {
    const subscription = await this.subscriptionModel.findOne({
      stripeSubscriptionId: (invoice as any).subscription as string,
    });

    if (subscription) {
      await this.paymentModel.create({
        userId: subscription.userId,
        amount: invoice.amount_paid / 100,
        currency: invoice.currency,
        status: 'succeeded',
        stripePaymentIntentId: (invoice as any).payment_intent as string,
        stripeInvoiceId: invoice.id,
        description: invoice.description,
        paidAt: new Date(),
      });
    }
  }

  private getPriceId(planId: string, billingCycle: string): string {
    // Return actual Stripe price IDs
    const priceIds: Record<string, string> = {
      'pro-monthly': this.configService.get('STRIPE_PRO_MONTHLY_PRICE_ID') || '',
      'pro-annual': this.configService.get('STRIPE_PRO_ANNUAL_PRICE_ID') || '',
      'elite-monthly': this.configService.get('STRIPE_ELITE_MONTHLY_PRICE_ID') || '',
      'elite-annual': this.configService.get('STRIPE_ELITE_ANNUAL_PRICE_ID') || '',
    };
    return priceIds[`${planId}-${billingCycle}`] || '';
  }
}
