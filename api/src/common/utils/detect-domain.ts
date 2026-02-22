/**
 * Detect domain from tech stack keywords.
 *
 * Centralised helper used by multiple services (daily-tasks, pool-manager,
 * priority-question-provider) so the mapping stays consistent.
 */
export function detectDomain(techStack: string[]): string {
  if (!techStack || techStack.length === 0) return 'general';

  const allTech = techStack.map((t) => t.toLowerCase()).join(' ');

  const FRONTEND_KEYWORDS = [
    'react',
    'vue',
    'angular',
    'svelte',
    'next',
    'css',
    'html',
    'frontend',
  ];
  const BACKEND_KEYWORDS = [
    'node',
    'express',
    'nest',
    'django',
    'flask',
    'spring',
    'laravel',
    'go',
    'java',
    'python',
    'backend',
    'sql',
  ];
  const MOBILE_KEYWORDS = [
    'ios',
    'android',
    'swift',
    'kotlin',
    'flutter',
    'react-native',
    'react native',
  ];
  const DEVOPS_KEYWORDS = [
    'docker',
    'kubernetes',
    'jenkins',
    'terraform',
    'aws',
    'azure',
    'gcp',
    'ci/cd',
  ];

  const hasFrontend = FRONTEND_KEYWORDS.some((kw) => allTech.includes(kw));
  const hasBackend = BACKEND_KEYWORDS.some((kw) => allTech.includes(kw));

  if (hasFrontend && hasBackend) return 'fullstack';
  if (hasFrontend) return 'frontend';
  if (hasBackend) return 'backend';
  if (MOBILE_KEYWORDS.some((kw) => allTech.includes(kw))) return 'mobile';
  if (DEVOPS_KEYWORDS.some((kw) => allTech.includes(kw))) return 'devops';

  return 'general';
}
