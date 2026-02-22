import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequestUser } from '@common/interfaces/jwt-payload.interface';
import { Public } from '@common/decorators/public.decorator';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@ApiTags('Payments & Subscriptions')
@Controller('payments')
export class PaymentsController {
  private readonly stripe: Stripe | null = null;
  private readonly isStripeEnabled: boolean;

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
  ) {
    const stripeApiKey = this.configService.get<string>('STRIPE_API_KEY');
    this.isStripeEnabled = !!stripeApiKey && stripeApiKey.length > 0;

    if (this.isStripeEnabled) {
      this.stripe = new Stripe(stripeApiKey!, {
        apiVersion: '2025-10-29.clover',
      });
    }
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create checkout session' })
  @ApiResponse({ status: 201, description: 'Checkout session created' })
  async createCheckout(
    @CurrentUser() user: RequestUser,
    @Body() body: { planId: string; billingCycle: 'monthly' | 'annual' },
  ) {
    return await this.paymentsService.createCheckoutSession(
      user.id,
      body.planId,
      body.billingCycle,
    );
  }

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook handler' })
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    if (!this.stripe || !this.isStripeEnabled) {
      return { error: 'Stripe not configured' };
    }

    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');

    try {
      const event = this.stripe.webhooks.constructEvent(
        req.rawBody || Buffer.from([]),
        signature,
        webhookSecret || '',
      );

      await this.paymentsService.handleWebhook(event);
      return { received: true };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  @Get('plans')
  @Public()
  @ApiOperation({ summary: 'Get available plans' })
  async getPlans() {
    return {
      // ALIGNED with COMPLETE_PLAN_LIMITS (single source of truth)
      plans: [
        {
          id: 'free_trial',
          name: 'Free Trial (7 days)',
          price: { monthly: 0, annual: 0 },
          features: ['1 mock interview (text only)', '1 CV analysis', 'No voice', 'No daily tasks'],
        },
        {
          id: 'starter',
          name: 'Starter',
          price: { monthly: 10, annual: 100 },
          features: [
            '10 mock interviews/mo',
            '10 min mock voice + 15 min live voice',
            '5 CV analyses',
            '1 daily task',
            'Monthly AI report',
          ],
        },
        {
          id: 'pro',
          name: 'Pro',
          price: { monthly: 20, annual: 200 },
          features: [
            '30 mock interviews/mo',
            '30 min mock voice + 45 min live voice',
            '15 CV analyses',
            '1 daily task',
            'Weekly AI recommendations',
          ],
        },
        {
          id: 'elite',
          name: 'Elite',
          price: { monthly: 30, annual: 299.99 },
          features: [
            'Unlimited mock interviews',
            '60 min mock voice + 120 min live voice',
            'Unlimited CV analyses',
            '2 daily tasks',
            'Weekly AI roadmap',
            'Priority support',
          ],
        },
      ],
    };
  }
}
