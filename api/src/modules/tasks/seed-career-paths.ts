/**
 * Career Path Seed Data - Most Popular IT Careers
 *
 * 50 popular career paths to start with.
 * Users can select during onboarding.
 *
 * STRATEGY:
 * - Start with 50 most common paths
 * - Add more as user demand grows
 * - AI generates questions for active paths only
 */

export const CAREER_PATHS = [
  // ============================================
  // SOFTWARE ENGINEERING (15 paths)
  // ============================================
  {
    slug: 'frontend-react',
    name: {
      uz: 'React Frontend Dasturchi',
      ru: 'React Frontend Разработчик',
      en: 'React Frontend Developer',
    },
    category: 'software-engineering',
    commonTechnologies: ['React', 'JavaScript', 'TypeScript', 'HTML', 'CSS', 'Redux', 'Next.js'],
    relatedPaths: ['frontend-vue', 'fullstack-js', 'mobile-react-native'],
  },
  {
    slug: 'frontend-vue',
    name: {
      uz: 'Vue.js Frontend Dasturchi',
      ru: 'Vue.js Frontend Разработчик',
      en: 'Vue.js Frontend Developer',
    },
    category: 'software-engineering',
    commonTechnologies: ['Vue.js', 'JavaScript', 'TypeScript', 'HTML', 'CSS', 'Pinia', 'Nuxt.js'],
    relatedPaths: ['frontend-react', 'fullstack-js'],
  },
  {
    slug: 'backend-nodejs',
    name: {
      uz: 'Node.js Backend Dasturchi',
      ru: 'Node.js Backend Разработчик',
      en: 'Node.js Backend Developer',
    },
    category: 'software-engineering',
    commonTechnologies: ['Node.js', 'Express', 'MongoDB', 'PostgreSQL', 'Redis', 'Docker'],
    relatedPaths: ['backend-python', 'fullstack-js', 'devops'],
  },
  {
    slug: 'backend-python',
    name: {
      uz: 'Python Backend Dasturchi',
      ru: 'Python Backend Разработчик',
      en: 'Python Backend Developer',
    },
    category: 'software-engineering',
    commonTechnologies: ['Python', 'Django', 'FastAPI', 'PostgreSQL', 'Redis', 'Celery'],
    relatedPaths: ['backend-nodejs', 'data-engineer', 'ml-engineer'],
  },
  {
    slug: 'backend-java',
    name: {
      uz: 'Java Backend Dasturchi',
      ru: 'Java Backend Разработчик',
      en: 'Java Backend Developer',
    },
    category: 'software-engineering',
    commonTechnologies: ['Java', 'Spring Boot', 'Hibernate', 'PostgreSQL', 'Kafka', 'Docker'],
    relatedPaths: ['backend-kotlin', 'android-native'],
  },
  {
    slug: 'fullstack-js',
    name: {
      uz: 'Full Stack JavaScript Dasturchi',
      ru: 'Full Stack JavaScript Разработчик',
      en: 'Full Stack JavaScript Developer',
    },
    category: 'software-engineering',
    commonTechnologies: ['React', 'Node.js', 'MongoDB', 'PostgreSQL', 'Express', 'Docker'],
    relatedPaths: ['frontend-react', 'backend-nodejs'],
  },
  {
    slug: 'mobile-react-native',
    name: {
      uz: 'React Native Mobile Dasturchi',
      ru: 'React Native Mobile Разработчик',
      en: 'React Native Mobile Developer',
    },
    category: 'software-engineering',
    commonTechnologies: ['React Native', 'JavaScript', 'TypeScript', 'iOS', 'Android', 'Expo'],
    relatedPaths: ['frontend-react', 'mobile-flutter'],
  },
  {
    slug: 'mobile-flutter',
    name: {
      uz: 'Flutter Mobile Dasturchi',
      ru: 'Flutter Mobile Разработчик',
      en: 'Flutter Mobile Developer',
    },
    category: 'software-engineering',
    commonTechnologies: ['Flutter', 'Dart', 'Firebase', 'iOS', 'Android', 'BLoC'],
    relatedPaths: ['mobile-react-native', 'frontend-react'],
  },
  {
    slug: 'android-native',
    name: {
      uz: 'Android Native Dasturchi',
      ru: 'Android Native Разработчик',
      en: 'Android Native Developer',
    },
    category: 'software-engineering',
    commonTechnologies: ['Kotlin', 'Java', 'Android SDK', 'Jetpack Compose', 'Room', 'Retrofit'],
    relatedPaths: ['mobile-react-native', 'mobile-flutter'],
  },
  {
    slug: 'ios-native',
    name: {
      uz: 'iOS Native Dasturchi',
      ru: 'iOS Native Разработчик',
      en: 'iOS Native Developer',
    },
    category: 'software-engineering',
    commonTechnologies: ['Swift', 'SwiftUI', 'UIKit', 'Core Data', 'Combine', 'Xcode'],
    relatedPaths: ['mobile-react-native', 'mobile-flutter'],
  },
  {
    slug: 'backend-go',
    name: {
      uz: 'Go Backend Dasturchi',
      ru: 'Go Backend Разработчик',
      en: 'Go Backend Developer',
    },
    category: 'software-engineering',
    commonTechnologies: ['Go', 'Gin', 'gRPC', 'PostgreSQL', 'Redis', 'Docker', 'Kubernetes'],
    relatedPaths: ['backend-nodejs', 'devops'],
  },
  {
    slug: 'backend-rust',
    name: {
      uz: 'Rust Backend Dasturchi',
      ru: 'Rust Backend Разработчик',
      en: 'Rust Backend Developer',
    },
    category: 'software-engineering',
    commonTechnologies: ['Rust', 'Actix-web', 'Tokio', 'PostgreSQL', 'Redis', 'WebAssembly'],
    relatedPaths: ['backend-go', 'systems-programming'],
  },
  {
    slug: 'backend-php',
    name: {
      uz: 'PHP Backend Dasturchi',
      ru: 'PHP Backend Разработчик',
      en: 'PHP Backend Developer',
    },
    category: 'software-engineering',
    commonTechnologies: ['PHP', 'Laravel', 'Symfony', 'MySQL', 'Redis', 'Docker'],
    relatedPaths: ['backend-nodejs', 'wordpress-developer'],
  },
  {
    slug: 'wordpress-developer',
    name: {
      uz: 'WordPress Dasturchi',
      ru: 'WordPress Разработчик',
      en: 'WordPress Developer',
    },
    category: 'software-engineering',
    commonTechnologies: ['PHP', 'WordPress', 'MySQL', 'JavaScript', 'CSS', 'Elementor'],
    relatedPaths: ['backend-php', 'frontend-react'],
  },
  {
    slug: 'game-developer',
    name: {
      uz: "O'yin Dasturchisi",
      ru: 'Разработчик Игр',
      en: 'Game Developer',
    },
    category: 'software-engineering',
    commonTechnologies: ['Unity', 'C#', 'Unreal Engine', 'C++', 'Blender', 'Game Design'],
    relatedPaths: ['backend-csharp', 'graphics-programmer'],
  },

  // ============================================
  // DEVOPS & INFRASTRUCTURE (8 paths)
  // ============================================
  {
    slug: 'devops-aws',
    name: {
      uz: 'AWS DevOps Muhandisi',
      ru: 'AWS DevOps Инженер',
      en: 'AWS DevOps Engineer',
    },
    category: 'devops',
    commonTechnologies: ['AWS', 'Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'Linux'],
    relatedPaths: ['devops-azure', 'cloud-architect'],
  },
  {
    slug: 'devops-azure',
    name: {
      uz: 'Azure DevOps Muhandisi',
      ru: 'Azure DevOps Инженер',
      en: 'Azure DevOps Engineer',
    },
    category: 'devops',
    commonTechnologies: ['Azure', 'Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'Linux'],
    relatedPaths: ['devops-aws', 'cloud-architect'],
  },
  {
    slug: 'devops-gcp',
    name: {
      uz: 'Google Cloud DevOps Muhandisi',
      ru: 'Google Cloud DevOps Инженер',
      en: 'Google Cloud DevOps Engineer',
    },
    category: 'devops',
    commonTechnologies: ['GCP', 'Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'Linux'],
    relatedPaths: ['devops-aws', 'cloud-architect'],
  },
  {
    slug: 'sre-engineer',
    name: {
      uz: 'SRE Muhandisi',
      ru: 'SRE Инженер',
      en: 'Site Reliability Engineer',
    },
    category: 'devops',
    commonTechnologies: ['Kubernetes', 'Prometheus', 'Grafana', 'Terraform', 'Go', 'Python'],
    relatedPaths: ['devops-aws', 'platform-engineer'],
  },
  {
    slug: 'platform-engineer',
    name: {
      uz: 'Platform Muhandisi',
      ru: 'Platform Инженер',
      en: 'Platform Engineer',
    },
    category: 'devops',
    commonTechnologies: ['Kubernetes', 'GitOps', 'ArgoCD', 'Terraform', 'Backstage', 'Go'],
    relatedPaths: ['devops-aws', 'sre-engineer'],
  },
  {
    slug: 'cloud-architect',
    name: {
      uz: 'Cloud Arxitektor',
      ru: 'Cloud Архитектор',
      en: 'Cloud Architect',
    },
    category: 'devops',
    commonTechnologies: ['AWS/Azure/GCP', 'Kubernetes', 'Terraform', 'Microservices', 'Security'],
    relatedPaths: ['devops-aws', 'solutions-architect'],
  },
  {
    slug: 'security-engineer',
    name: {
      uz: 'Xavfsizlik Muhandisi',
      ru: 'Инженер Безопасности',
      en: 'Security Engineer',
    },
    category: 'devops',
    commonTechnologies: ['Penetration Testing', 'OWASP', 'SIEM', 'Cryptography', 'Compliance'],
    relatedPaths: ['devops-aws', 'cloud-architect'],
  },
  {
    slug: 'database-admin',
    name: {
      uz: "Ma'lumotlar Bazasi Administratori",
      ru: 'Администратор Баз Данных',
      en: 'Database Administrator',
    },
    category: 'devops',
    commonTechnologies: [
      'PostgreSQL',
      'MySQL',
      'MongoDB',
      'Redis',
      'AWS RDS',
      'Performance Tuning',
    ],
    relatedPaths: ['backend-nodejs', 'data-engineer'],
  },

  // ============================================
  // DATA SCIENCE & AI (8 paths)
  // ============================================
  {
    slug: 'data-scientist',
    name: {
      uz: 'Data Scientist',
      ru: 'Data Scientist',
      en: 'Data Scientist',
    },
    category: 'data-science',
    commonTechnologies: ['Python', 'Pandas', 'Scikit-learn', 'TensorFlow', 'SQL', 'Statistics'],
    relatedPaths: ['ml-engineer', 'data-analyst'],
  },
  {
    slug: 'ml-engineer',
    name: {
      uz: 'Machine Learning Muhandisi',
      ru: 'Machine Learning Инженер',
      en: 'Machine Learning Engineer',
    },
    category: 'data-science',
    commonTechnologies: ['Python', 'TensorFlow', 'PyTorch', 'Kubernetes', 'MLOps', 'Docker'],
    relatedPaths: ['data-scientist', 'ai-engineer'],
  },
  {
    slug: 'ai-engineer',
    name: {
      uz: 'AI Muhandisi',
      ru: 'AI Инженер',
      en: 'AI Engineer',
    },
    category: 'data-science',
    commonTechnologies: ['Python', 'OpenAI API', 'LangChain', 'Vector DB', 'NLP', 'LLMs'],
    relatedPaths: ['ml-engineer', 'data-scientist'],
  },
  {
    slug: 'data-analyst',
    name: {
      uz: 'Data Analyst',
      ru: 'Data Analyst',
      en: 'Data Analyst',
    },
    category: 'data-science',
    commonTechnologies: ['SQL', 'Python', 'Excel', 'Tableau', 'PowerBI', 'Statistics'],
    relatedPaths: ['data-scientist', 'business-analyst'],
  },
  {
    slug: 'data-engineer',
    name: {
      uz: 'Data Engineer',
      ru: 'Data Engineer',
      en: 'Data Engineer',
    },
    category: 'data-science',
    commonTechnologies: ['Python', 'Apache Spark', 'Kafka', 'Airflow', 'AWS', 'SQL'],
    relatedPaths: ['data-scientist', 'ml-engineer'],
  },
  {
    slug: 'nlp-engineer',
    name: {
      uz: 'NLP Muhandisi',
      ru: 'NLP Инженер',
      en: 'NLP Engineer',
    },
    category: 'data-science',
    commonTechnologies: ['Python', 'NLTK', 'spaCy', 'Transformers', 'BERT', 'GPT'],
    relatedPaths: ['ai-engineer', 'ml-engineer'],
  },
  {
    slug: 'computer-vision',
    name: {
      uz: 'Computer Vision Dasturchi',
      ru: 'Computer Vision Разработчик',
      en: 'Computer Vision Engineer',
    },
    category: 'data-science',
    commonTechnologies: ['Python', 'OpenCV', 'PyTorch', 'TensorFlow', 'YOLO', 'CNNs'],
    relatedPaths: ['ml-engineer', 'ai-engineer'],
  },
  {
    slug: 'business-analyst',
    name: {
      uz: 'Business Analyst',
      ru: 'Business Analyst',
      en: 'Business Analyst',
    },
    category: 'data-science',
    commonTechnologies: ['SQL', 'Excel', 'PowerBI', 'Tableau', 'Python', 'Statistics'],
    relatedPaths: ['data-analyst', 'product-manager'],
  },

  // ============================================
  // PRODUCT & DESIGN (7 paths)
  // ============================================
  {
    slug: 'product-manager',
    name: {
      uz: 'Product Manager',
      ru: 'Product Manager',
      en: 'Product Manager',
    },
    category: 'product',
    commonTechnologies: ['Agile', 'Scrum', 'Jira', 'Roadmapping', 'User Research', 'Analytics'],
    relatedPaths: ['product-owner', 'business-analyst'],
  },
  {
    slug: 'product-owner',
    name: {
      uz: 'Product Owner',
      ru: 'Product Owner',
      en: 'Product Owner',
    },
    category: 'product',
    commonTechnologies: ['Agile', 'Scrum', 'Jira', 'User Stories', 'Backlog Management'],
    relatedPaths: ['product-manager', 'scrum-master'],
  },
  {
    slug: 'ui-ux-designer',
    name: {
      uz: 'UI/UX Dizayner',
      ru: 'UI/UX Дизайнер',
      en: 'UI/UX Designer',
    },
    category: 'product',
    commonTechnologies: ['Figma', 'Adobe XD', 'Sketch', 'Prototyping', 'User Research'],
    relatedPaths: ['frontend-react', 'product-manager'],
  },
  {
    slug: 'ux-researcher',
    name: {
      uz: 'UX Researcher',
      ru: 'UX Researcher',
      en: 'UX Researcher',
    },
    category: 'product',
    commonTechnologies: ['User Testing', 'Usability Testing', 'Figma', 'Analytics', 'Interviews'],
    relatedPaths: ['ui-ux-designer', 'product-manager'],
  },
  {
    slug: 'scrum-master',
    name: {
      uz: 'Scrum Master',
      ru: 'Scrum Master',
      en: 'Scrum Master',
    },
    category: 'product',
    commonTechnologies: ['Agile', 'Scrum', 'Kanban', 'Jira', 'Facilitation', 'Coaching'],
    relatedPaths: ['product-owner', 'agile-coach'],
  },
  {
    slug: 'agile-coach',
    name: {
      uz: 'Agile Coach',
      ru: 'Agile Coach',
      en: 'Agile Coach',
    },
    category: 'product',
    commonTechnologies: ['Agile', 'Scrum', 'Kanban', 'SAFe', 'Transformation', 'Coaching'],
    relatedPaths: ['scrum-master', 'product-manager'],
  },
  {
    slug: 'technical-writer',
    name: {
      uz: 'Technical Writer',
      ru: 'Technical Writer',
      en: 'Technical Writer',
    },
    category: 'product',
    commonTechnologies: ['Markdown', 'API Documentation', 'Confluence', 'Git', 'Swagger'],
    relatedPaths: ['frontend-react', 'backend-nodejs'],
  },

  // ============================================
  // QA & TESTING (5 paths)
  // ============================================
  {
    slug: 'qa-manual',
    name: {
      uz: 'QA Engineer (Manual)',
      ru: 'QA Engineer (Ручное Тестирование)',
      en: 'QA Engineer (Manual)',
    },
    category: 'qa',
    commonTechnologies: ['Test Cases', 'Bug Tracking', 'Jira', 'TestRail', 'Regression Testing'],
    relatedPaths: ['qa-automation', 'sdet'],
  },
  {
    slug: 'qa-automation',
    name: {
      uz: 'QA Automation Engineer',
      ru: 'QA Automation Инженер',
      en: 'QA Automation Engineer',
    },
    category: 'qa',
    commonTechnologies: ['Selenium', 'Cypress', 'Playwright', 'JavaScript', 'Python', 'CI/CD'],
    relatedPaths: ['sdet', 'qa-manual'],
  },
  {
    slug: 'sdet',
    name: {
      uz: 'SDET (Software Development Engineer in Test)',
      ru: 'SDET',
      en: 'SDET',
    },
    category: 'qa',
    commonTechnologies: ['Java', 'Python', 'Selenium', 'API Testing', 'Test Frameworks', 'CI/CD'],
    relatedPaths: ['qa-automation', 'backend-java'],
  },
  {
    slug: 'performance-tester',
    name: {
      uz: 'Performance Test Engineer',
      ru: 'Performance Test Инженер',
      en: 'Performance Test Engineer',
    },
    category: 'qa',
    commonTechnologies: ['JMeter', 'Gatling', 'LoadRunner', 'K6', 'Monitoring', 'Analysis'],
    relatedPaths: ['qa-automation', 'devops-aws'],
  },
  {
    slug: 'security-tester',
    name: {
      uz: 'Security Tester',
      ru: 'Security Tester',
      en: 'Security Tester',
    },
    category: 'qa',
    commonTechnologies: ['OWASP', 'Penetration Testing', 'Burp Suite', 'Vulnerability Scanning'],
    relatedPaths: ['security-engineer', 'qa-automation'],
  },

  // ============================================
  // SPECIALIZED ROLES (7 paths)
  // ============================================
  {
    slug: 'blockchain-developer',
    name: {
      uz: 'Blockchain Dasturchi',
      ru: 'Blockchain Разработчик',
      en: 'Blockchain Developer',
    },
    category: 'specialized',
    commonTechnologies: ['Solidity', 'Ethereum', 'Web3.js', 'Smart Contracts', 'DeFi', 'NFTs'],
    relatedPaths: ['backend-nodejs', 'security-engineer'],
  },
  {
    slug: 'embedded-developer',
    name: {
      uz: 'Embedded Systems Dasturchi',
      ru: 'Embedded Systems Разработчик',
      en: 'Embedded Systems Developer',
    },
    category: 'specialized',
    commonTechnologies: ['C/C++', 'RTOS', 'Microcontrollers', 'IoT', 'Hardware', 'Sensors'],
    relatedPaths: ['backend-c', 'iot-developer'],
  },
  {
    slug: 'iot-developer',
    name: {
      uz: 'IoT Dasturchi',
      ru: 'IoT Разработчик',
      en: 'IoT Developer',
    },
    category: 'specialized',
    commonTechnologies: ['Python', 'MQTT', 'AWS IoT', 'Raspberry Pi', 'Sensors', 'Edge Computing'],
    relatedPaths: ['embedded-developer', 'backend-python'],
  },
  {
    slug: 'ar-vr-developer',
    name: {
      uz: 'AR/VR Dasturchi',
      ru: 'AR/VR Разработчик',
      en: 'AR/VR Developer',
    },
    category: 'specialized',
    commonTechnologies: ['Unity', 'Unreal Engine', 'C#', 'C++', 'ARKit', 'ARCore'],
    relatedPaths: ['game-developer', 'mobile-react-native'],
  },
  {
    slug: 'solutions-architect',
    name: {
      uz: 'Solutions Arxitektor',
      ru: 'Solutions Архитектор',
      en: 'Solutions Architect',
    },
    category: 'specialized',
    commonTechnologies: [
      'System Design',
      'AWS/Azure/GCP',
      'Microservices',
      'Security',
      'Cost Optimization',
    ],
    relatedPaths: ['cloud-architect', 'technical-lead'],
  },
  {
    slug: 'technical-lead',
    name: {
      uz: 'Technical Lead',
      ru: 'Technical Lead',
      en: 'Technical Lead',
    },
    category: 'specialized',
    commonTechnologies: [
      'Architecture',
      'Mentoring',
      'Code Review',
      'Technical Strategy',
      'Leadership',
    ],
    relatedPaths: ['solutions-architect', 'engineering-manager'],
  },
  {
    slug: 'engineering-manager',
    name: {
      uz: 'Engineering Manager',
      ru: 'Engineering Manager',
      en: 'Engineering Manager',
    },
    category: 'specialized',
    commonTechnologies: [
      'Team Management',
      'Hiring',
      'Performance Reviews',
      'Strategy',
      'Leadership',
    ],
    relatedPaths: ['technical-lead', 'cto'],
  },
];
