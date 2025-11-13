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
      plans: [
        {
          id: 'free',
          name: 'Free',
          price: { monthly: 0, annual: 0 },
          features: ['3 mock interviews/month', 'Basic AI', '1 CV analysis'],
        },
        {
          id: 'pro',
          name: 'Pro',
          price: { monthly: 14.99, annual: 149.99 },
          features: ['50 interviews/month', 'GPT-4', '10 CV analyses', 'Chrome extension'],
        },
        {
          id: 'elite',
          name: 'Elite',
          price: { monthly: 29.99, annual: 299.99 },
          features: ['Unlimited interviews', 'GPT-4', 'Unlimited CV', 'Priority support'],
        },
      ],
    };
  }
}
