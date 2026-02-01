import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { JwtService } from '@nestjs/jwt';

describe('AdminController (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let adminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    jwtService = moduleFixture.get<JwtService>(JwtService);

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    adminToken = jwtService.sign({
      sub: 'admin-id',
      role: 'admin',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/admin/overview', () => {
    it('GET - should return dashboard overview', () => {
      return request(app.getHttpServer())
        .get('/admin/overview')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('planDistribution');
          expect(res.body).toHaveProperty('featureUsage');
          expect(res.body).toHaveProperty('users');
          expect(res.body).toHaveProperty('generatedAt');
        });
    });

    it('GET - should require authentication', () => {
      return request(app.getHttpServer())
        .get('/admin/overview')
        .expect(401);
    });
  });

  describe('/admin/users', () => {
    it('GET - should return paginated users', () => {
      return request(app.getHttpServer())
        .get('/admin/users?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('users');
          expect(res.body).toHaveProperty('pagination');
          expect(res.body.pagination).toHaveProperty('page');
          expect(res.body.pagination).toHaveProperty('limit');
          expect(res.body.pagination).toHaveProperty('total');
        });
    });

    it('GET - should support search by phone number', () => {
      return request(app.getHttpServer())
        .get('/admin/users?search=998901234567')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.users).toBeDefined();
        });
    });

    it('GET - should support filter by plan', () => {
      return request(app.getHttpServer())
        .get('/admin/users?plan=starter')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.users).toBeDefined();
        });
    });
  });

  describe('/admin/plans', () => {
    it('GET - should return plan distribution', () => {
      return request(app.getHttpServer())
        .get('/admin/plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('total');
          expect(res.body).toHaveProperty('distribution');
          expect(res.body).toHaveProperty('percentage');
        });
    });
  });

  describe('/admin/usage', () => {
    it('GET - should return feature usage analytics', () => {
      return request(app.getHttpServer())
        .get('/admin/usage?days=30')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('period');
          expect(res.body).toHaveProperty('features');
          expect(res.body).toHaveProperty('total');
        });
    });
  });

  describe('/admin/revenue', () => {
    it('GET - should return revenue metrics', () => {
      return request(app.getHttpServer())
        .get('/admin/revenue?days=30')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('period');
          expect(res.body).toHaveProperty('dailyRevenue');
          expect(res.body).toHaveProperty('summary');
        });
    });

    it('GET - should support filter by plan', () => {
      return request(app.getHttpServer())
        .get('/admin/revenue?days=30&plan=pro')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('dailyRevenue');
        });
    });
  });

  describe('/admin/daily-tasks', () => {
    it('GET - should return daily task analytics', () => {
      return request(app.getHttpServer())
        .get('/admin/daily-tasks?days=30')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('period');
          expect(res.body).toHaveProperty('dailyCompletion');
          expect(res.body).toHaveProperty('summary');
        });
    });
  });

  describe('/admin/voice-quota', () => {
    it('GET - should return voice quota usage', () => {
      return request(app.getHttpServer())
        .get('/admin/voice-quota?days=30')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('period');
          expect(res.body).toHaveProperty('dailyUsage');
          expect(res.body).toHaveProperty('summary');
        });
    });
  });

  describe('/admin/users/:userId', () => {
    it('GET - should return user details', async () => {
      const usersResponse = await request(app.getHttpServer())
        .get('/admin/users?limit=1')
        .set('Authorization', `Bearer ${adminToken}`);

      if (usersResponse.body.users && usersResponse.body.users.length > 0) {
        const userId = usersResponse.body.users[0].id;
        
        return request(app.getHttpServer())
          .get(`/admin/users/${userId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200)
          .expect((res) => {
            expect(res.body).toHaveProperty('user');
            expect(res.body).toHaveProperty('voiceQuota');
            expect(res.body).toHaveProperty('usage');
          });
      }
    });

    it('GET - should return 404 for non-existent user', () => {
      return request(app.getHttpServer())
        .get('/admin/users/non-existent-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });
});
