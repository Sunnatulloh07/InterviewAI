import { Controller, Get, Post, Put, Body, Query, Param, UseGuards, Delete, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UsersRepository } from '../users/users.repository';
import { AnalyticsService } from '../analytics/analytics.service';
import { VoiceQuotaService } from '../voice/voice-quota.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { UserRole } from '@common/enums/user-role.enum';

/**
 * Admin Controller
 *
 * FIX BUG-01: Added RolesGuard + @Roles(UserRole.ADMIN) on every endpoint.
 * Previously only JwtAuthGuard was present — any authenticated user could
 * call all admin endpoints (view all users, change subscriptions, add voice
 * quota, etc.).
 *
 * Now requires: valid JWT (JwtAuthGuard) AND role === 'admin' (RolesGuard).
 * Non-admin users receive 403 Forbidden automatically via RolesGuard.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly analyticsService: AnalyticsService,
    private readonly voiceQuotaService: VoiceQuotaService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get admin dashboard overview' })
  @ApiResponse({ status: 200, description: 'Dashboard overview retrieved' })
  async getOverview() {
    const [overview, users, subscriptions] = await Promise.all([
      this.analyticsService.getAnalyticsOverview(),
      this.usersRepository.count(),
      this.getSubscriptionSummary(),
    ]);

    return {
      ...overview,
      users: {
        total: users,
      },
      subscriptions: {
        total: subscriptions.total,
        active: subscriptions.active,
        trial: subscriptions.trial,
      },
      generatedAt: new Date(),
    };
  }

  @Get('users')
  @ApiOperation({ summary: 'Get all users (paginated)' })
  @ApiResponse({ status: 200, description: 'Users retrieved' })
  async getUsers(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('search') search?: string,
    @Query('plan') plan?: string,
  ) {
    // FIX BUG-14: Replaced O(N) findAll()->slice() with DB-level skip/limit + countDocuments.
    // Previously loaded entire user collection into RAM on every paginated request.
    const safeLimit = Math.min(Number(limit) || 20, 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const filters: any = { deletedAt: null };

    if (search) {
      filters.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } },
      ];
    }

    if (plan) {
      filters['subscription.plan'] = plan;
    }

    // Parallel: fetch page + total count in one round-trip
    const [users, total] = await Promise.all([
      this.usersRepository.model
        .find(filters)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      this.usersRepository.model.countDocuments(filters),
    ]);

    return {
      users,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    };
  }

  @Get('users/:userId')
  @ApiOperation({ summary: 'Get user details' })
  @ApiResponse({ status: 200, description: 'User details retrieved' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserDetails(@Param('userId') userId: string) {
    const user = await this.usersRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [quota, analytics] = await Promise.all([
      this.voiceQuotaService.getQuota(userId),
      this.analyticsService.getUsageStats(userId, 30),
    ]);

    return {
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        language: user.language,
        plan: user.subscription?.plan,
        subscriptionStatus: user.subscription?.status,
        createdAt: user.createdAt,
      },
      voiceQuota: quota,
      usage: analytics,
    };
  }

  @Post('users/:userId/subscription')
  @ApiOperation({ summary: 'Update user subscription' })
  @ApiResponse({ status: 200, description: 'Subscription updated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateSubscription(
    @Param('userId') userId: string,
    @Body() data: { plan: string; duration?: number },
  ) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const subscriptionData: any = {
      plan: data.plan,
      status: 'active',
      startDate: new Date(),
    };

    if (data.duration) {
      subscriptionData.endDate = new Date(Date.now() + data.duration * 24 * 60 * 60 * 1000);
    }

    await this.usersRepository.update(userId, { subscription: subscriptionData });

    return { success: true };
  }

  @Delete('users/:userId/subscription')
  @ApiOperation({ summary: 'Cancel user subscription' })
  @ApiResponse({ status: 200, description: 'Subscription cancelled' })
  @ApiResponse({ status: 404, description: 'User or subscription not found' })
  async cancelSubscription(@Param('userId') userId: string) {
    const user = await this.usersRepository.findById(userId);
    if (!user || !user.subscription) {
      throw new NotFoundException('User or subscription not found');
    }

    await this.usersRepository.update(userId, {
      subscription: {
        ...user.subscription,
        status: 'cancelled',
        endDate: new Date(),
      },
    });

    return { success: true };
  }

  @Post('users/:userId/voice-quota')
  @ApiOperation({ summary: 'Add voice quota to user' })
  @ApiResponse({ status: 200, description: 'Voice quota added' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async addVoiceQuota(
    @Param('userId') userId: string,
    @Body() data: { type: 'mock' | 'real'; minutes: number },
  ) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const quota = user.voiceQuota || {};
    const quotaKey = `${data.type}Voice` as keyof typeof quota;
    const currentTotal = (quota[quotaKey] as any)?.total || 0;
    const currentUsed = (quota[quotaKey] as any)?.used || 0;

    const newTotal = currentTotal + data.minutes;
    const newRemaining = newTotal - currentUsed;

    await this.usersRepository.update(userId, {
      voiceQuota: {
        ...quota,
        [quotaKey]: {
          total: newTotal,
          used: currentUsed,
          remaining: newRemaining,
          resetDate: (quota[quotaKey] as any)?.resetDate,
        },
      },
    });

    return { success: true, added: data.minutes };
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'Get all subscriptions' })
  @ApiResponse({ status: 200, description: 'Subscriptions retrieved' })
  async getSubscriptions(
    @Query('status') status?: string,
    @Query('plan') plan?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    // FIX BUG-14: DB-level pagination instead of in-memory slice
    const safeLimit = Math.min(Number(limit) || 20, 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const filters: any = { deletedAt: null };
    if (status) filters['subscription.status'] = status;
    if (plan) filters['subscription.plan'] = plan;

    const [users, total] = await Promise.all([
      this.usersRepository.model
        .find(filters)
        .select('_id subscription')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      this.usersRepository.model.countDocuments(filters),
    ]);

    return {
      subscriptions: users
        .filter((u) => u.subscription)
        .map((u) => ({
          userId: u._id,
          plan: u.subscription?.plan,
          status: u.subscription?.status,
          startDate: u.subscription?.startDate,
          endDate: u.subscription?.endDate,
        })),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    };
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Get revenue analytics' })
  @ApiResponse({ status: 200, description: 'Revenue analytics retrieved' })
  async getRevenue(@Query('days') days: number = 30, @Query('plan') plan?: string) {
    const revenue = await this.analyticsService.getRevenueMetrics(days);

    if (plan) {
      const filteredDailyRevenue: any = {};
      for (const [date, dailyPlans] of Object.entries(revenue.dailyRevenue)) {
        if ((dailyPlans as any)[plan]) {
          filteredDailyRevenue[date] = (dailyPlans as any)[plan];
        }
      }

      return {
        ...revenue,
        dailyRevenue: filteredDailyRevenue,
      };
    }

    return revenue;
  }

  @Get('usage')
  @ApiOperation({ summary: 'Get usage analytics' })
  @ApiResponse({ status: 200, description: 'Usage analytics retrieved' })
  async getUsage(@Query('days') days: number = 30) {
    return await this.analyticsService.getFeatureUsage(days);
  }

  @Get('plans')
  @ApiOperation({ summary: 'Get plan distribution' })
  @ApiResponse({ status: 200, description: 'Plan distribution retrieved' })
  async getPlanDistribution() {
    return await this.analyticsService.getPlanDistribution();
  }

  @Get('daily-tasks')
  @ApiOperation({ summary: 'Get daily task completion analytics' })
  @ApiResponse({ status: 200, description: 'Daily task analytics retrieved' })
  async getDailyTaskAnalytics(@Query('days') days: number = 30) {
    return await this.analyticsService.getDailyTaskCompletion(days);
  }

  @Get('voice-quota')
  @ApiOperation({ summary: 'Get voice quota usage analytics' })
  @ApiResponse({ status: 200, description: 'Voice quota usage retrieved' })
  async getVoiceQuotaAnalytics(@Query('days') days: number = 30) {
    return await this.analyticsService.getVoiceQuotaUsage(days);
  }

  private async getSubscriptionSummary() {
    // FIX BUG-14: Use MongoDB aggregation instead of loading all users into RAM.
    // Previously called findAll() (full collection) then iterated in JS memory.
    const [total, active, trial] = await Promise.all([
      this.usersRepository.model.countDocuments({ deletedAt: null }),
      this.usersRepository.model.countDocuments({
        deletedAt: null,
        'subscription.status': 'active',
      }),
      this.usersRepository.model.countDocuments({
        deletedAt: null,
        'subscription.plan': 'free_trial',
      }),
    ]);

    return { total, active, trial };
  }
}
