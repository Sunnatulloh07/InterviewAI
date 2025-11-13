/**
 * OpenRouter Integration Test
 *
 * This script tests the OpenRouter API integration
 * Run with: node test-openrouter.js
 */

const OpenAI = require('openai');

async function testOpenRouter() {
  console.log('🚀 Testing OpenRouter Integration...\n');

  const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: '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',
    defaultHeaders: {
      'HTTP-Referer': 'http://localhost:5173',
      'X-Title': 'InterviewAI Pro',
    },
  });

  try {
    // Test 1: Simple chat completion
    console.log('📝 Test 1: Simple Chat Completion');
    const completion = await openai.chat.completions.create({
      model: 'openai/gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful interview coach.',
        },
        {
          role: 'user',
          content: 'Generate one technical interview question for a junior JavaScript developer.',
        },
      ],
      max_tokens: 200,
      temperature: 0.7,
    });

    console.log('✅ Success!');
    console.log('Response:', completion.choices[0].message.content);
    console.log('\nModel used:', completion.model);
    console.log('Tokens used:', completion.usage);
    console.log('\n' + '='.repeat(60) + '\n');

    // Test 2: JSON response format
    console.log('📝 Test 2: JSON Response Format');
    const jsonCompletion = await openai.chat.completions.create({
      model: 'openai/gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a professional interview question generator. Always respond in valid JSON format.',
        },
        {
          role: 'user',
          content: 'Generate 3 technical interview questions. Return as JSON: {"questions": ["q1", "q2", "q3"]}',
        },
      ],
      max_tokens: 500,
      temperature: 0.8,
      response_format: { type: 'json_object' },
    });

    console.log('✅ Success!');
    const parsed = JSON.parse(jsonCompletion.choices[0].message.content);
    console.log('Questions:', parsed.questions);
    console.log('\n' + '='.repeat(60) + '\n');

    // Test 3: GPT-4 (if you have credits)
    console.log('📝 Test 3: GPT-4 Turbo');
    try {
      const gpt4Completion = await openai.chat.completions.create({
        model: 'openai/gpt-4-turbo',
        messages: [
          {
            role: 'user',
            content: 'Write a brief explanation of SOLID principles (max 100 words).',
          },
        ],
        max_tokens: 200,
      });

      console.log('✅ Success!');
      console.log('Response:', gpt4Completion.choices[0].message.content);
      console.log('\nModel used:', gpt4Completion.model);
      console.log('Tokens used:', gpt4Completion.usage);
    } catch (error) {
      console.log('⚠️  GPT-4 test failed (might need credits):', error.message);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed successfully!');
    console.log('🎉 OpenRouter integration is working!');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.status) {
      console.error('Status:', error.status);
    }
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

// Run tests
testOpenRouter();
