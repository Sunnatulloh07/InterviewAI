/**
 * Question Pattern Seed Data
 *
 * 20 core interview patterns that rotate over 20 weeks.
 * Each pattern represents a fundamental concept that AI will generate variations of.
 *
 * ROTATION STRATEGY:
 * Week 1-4:   Arrays & Strings (fundamentals)
 * Week 5-8:   Data Structures (hash maps, stacks, queues)
 * Week 9-12:  Algorithms (sorting, searching, recursion)
 * Week 13-16: Advanced DS (trees, graphs, heaps)
 * Week 17-20: System Design & Behavioral
 * Week 21+:   Repeat cycle (AI generates NEW variations)
 */

export const QUESTION_PATTERNS = [
  // ============================================
  // TECHNICAL PATTERNS (Weeks 1-16)
  // ============================================

  // Week 1: Arrays - Two Pointers
  {
    type: 'technical',
    weekNumber: 1,
    patternName: 'Two Pointers Technique',
    coreTemplate:
      'Given an array, find a pair/triplet that satisfies a condition using two pointers from both ends.',
    learningObjectives: ['Two-pointer technique', 'Array manipulation', 'Time complexity O(n)'],
    relatedTags: ['arrays', 'two-pointers', 'optimization'],
  },

  // Week 2: Arrays - Sliding Window
  {
    type: 'technical',
    weekNumber: 2,
    patternName: 'Sliding Window',
    coreTemplate:
      'Find a subarray or substring that satisfies a condition by sliding a window across the data.',
    learningObjectives: ['Sliding window pattern', 'Subarray problems', 'Dynamic window sizing'],
    relatedTags: ['arrays', 'strings', 'sliding-window'],
  },

  // Week 3: Strings - Pattern Matching
  {
    type: 'technical',
    weekNumber: 3,
    patternName: 'String Manipulation',
    coreTemplate: 'Solve a string problem involving reversal, rotation, or pattern matching.',
    learningObjectives: ['String algorithms', 'Character frequency', 'Pattern matching'],
    relatedTags: ['strings', 'hashing', 'patterns'],
  },

  // Week 4: Arrays - Prefix Sum
  {
    type: 'technical',
    weekNumber: 4,
    patternName: 'Prefix/Suffix Sum',
    coreTemplate: 'Use prefix sums or suffix sums to efficiently calculate range queries.',
    learningObjectives: ['Prefix sum technique', 'Range queries', 'Preprocessing optimization'],
    relatedTags: ['arrays', 'prefix-sum', 'optimization'],
  },

  // Week 5: Hash Maps
  {
    type: 'technical',
    weekNumber: 5,
    patternName: 'Hash Map Usage',
    coreTemplate:
      'Solve a problem using a hash map to track frequency, presence, or mapping relationships.',
    learningObjectives: ['Hash tables', 'O(1) lookups', 'Space-time tradeoffs'],
    relatedTags: ['hash-maps', 'dictionaries', 'lookups'],
  },

  // Week 6: Stacks
  {
    type: 'technical',
    weekNumber: 6,
    patternName: 'Stack Applications',
    coreTemplate:
      'Use a stack to solve problems involving parentheses, undo operations, or nearest element.',
    learningObjectives: ['Stack data structure', 'LIFO principle', 'Monotonic stacks'],
    relatedTags: ['stacks', 'parentheses', 'monotonic'],
  },

  // Week 7: Queues & Deques
  {
    type: 'technical',
    weekNumber: 7,
    patternName: 'Queue/Deque Techniques',
    coreTemplate:
      'Use queues or deques for BFS traversal, sliding window max, or level-order processing.',
    learningObjectives: ['Queue data structure', 'FIFO principle', 'Deque applications'],
    relatedTags: ['queues', 'deques', 'bfs'],
  },

  // Week 8: Linked Lists
  {
    type: 'technical',
    weekNumber: 8,
    patternName: 'Linked List Manipulation',
    coreTemplate:
      'Manipulate linked lists through reversal, merging, cycle detection, or node deletion.',
    learningObjectives: ['Linked lists', 'Pointer manipulation', 'Fast/slow pointer'],
    relatedTags: ['linked-lists', 'pointers', 'cycles'],
  },

  // Week 9: Binary Search
  {
    type: 'technical',
    weekNumber: 9,
    patternName: 'Binary Search Variants',
    coreTemplate:
      'Apply binary search to find an element, boundary, or optimal value in sorted data.',
    learningObjectives: ['Binary search', 'Log(n) complexity', 'Search space reduction'],
    relatedTags: ['binary-search', 'sorted-arrays', 'optimization'],
  },

  // Week 10: Sorting
  {
    type: 'technical',
    weekNumber: 10,
    patternName: 'Sorting Algorithms',
    coreTemplate: 'Use sorting or custom comparators to solve ordering problems efficiently.',
    learningObjectives: ['Sorting algorithms', 'Comparators', 'Time complexity'],
    relatedTags: ['sorting', 'comparators', 'quicksort'],
  },

  // Week 11: Recursion
  {
    type: 'technical',
    weekNumber: 11,
    patternName: 'Recursion & Backtracking',
    coreTemplate:
      'Solve problems using recursion, exploring all possibilities through backtracking.',
    learningObjectives: ['Recursion', 'Backtracking', 'Decision trees'],
    relatedTags: ['recursion', 'backtracking', 'dfs'],
  },

  // Week 12: Dynamic Programming (1D)
  {
    type: 'technical',
    weekNumber: 12,
    patternName: 'Dynamic Programming - 1D',
    coreTemplate: 'Use 1D DP to solve optimization problems with overlapping subproblems.',
    learningObjectives: ['Dynamic programming', 'Memoization', 'Optimal substructure'],
    relatedTags: ['dp', 'memoization', 'optimization'],
  },

  // Week 13: Trees - Traversal
  {
    type: 'technical',
    weekNumber: 13,
    patternName: 'Binary Tree Traversal',
    coreTemplate:
      'Traverse binary trees using DFS (preorder, inorder, postorder) or BFS (level-order).',
    learningObjectives: ['Tree traversal', 'DFS vs BFS', 'Recursion vs iteration'],
    relatedTags: ['trees', 'traversal', 'dfs', 'bfs'],
  },

  // Week 14: Trees - Properties
  {
    type: 'technical',
    weekNumber: 14,
    patternName: 'Binary Tree Properties',
    coreTemplate:
      'Calculate tree properties like height, diameter, balanced status, or lowest common ancestor.',
    learningObjectives: ['Tree properties', 'Height calculation', 'LCA'],
    relatedTags: ['trees', 'properties', 'lca'],
  },

  // Week 15: Graphs - BFS/DFS
  {
    type: 'technical',
    weekNumber: 15,
    patternName: 'Graph Traversal',
    coreTemplate:
      'Traverse graphs using BFS or DFS to find paths, connected components, or cycles.',
    learningObjectives: ['Graph traversal', 'BFS', 'DFS', 'Cycle detection'],
    relatedTags: ['graphs', 'bfs', 'dfs', 'cycles'],
  },

  // Week 16: Graphs - Shortest Path
  {
    type: 'technical',
    weekNumber: 16,
    patternName: 'Shortest Path Algorithms',
    coreTemplate: 'Find shortest paths in graphs using Dijkstra, BFS, or dynamic programming.',
    learningObjectives: ['Dijkstra', 'Shortest paths', 'Weighted graphs'],
    relatedTags: ['graphs', 'dijkstra', 'shortest-path'],
  },

  // ============================================
  // BEHAVIORAL PATTERNS (Weeks 17-19)
  // ============================================

  // Week 17: Leadership
  {
    type: 'behavioral',
    weekNumber: 17,
    patternName: 'Leadership & Mentorship',
    coreTemplate:
      'Describe a time you led a project, mentored someone, or made a strategic decision.',
    learningObjectives: ['Leadership skills', 'Mentorship', 'Strategic thinking'],
    relatedTags: ['leadership', 'mentorship', 'decision-making'],
  },

  // Week 18: Conflict Resolution
  {
    type: 'behavioral',
    weekNumber: 18,
    patternName: 'Conflict & Collaboration',
    coreTemplate: 'Tell me about a time you resolved a conflict or collaborated under pressure.',
    learningObjectives: ['Conflict resolution', 'Teamwork', 'Communication'],
    relatedTags: ['conflict', 'teamwork', 'communication'],
  },

  // Week 19: Problem Solving
  {
    type: 'behavioral',
    weekNumber: 19,
    patternName: 'Problem-Solving Stories',
    coreTemplate: 'Describe a challenging technical problem you solved and your approach.',
    learningObjectives: ['Problem-solving', 'Analytical thinking', 'Persistence'],
    relatedTags: ['problem-solving', 'debugging', 'persistence'],
  },

  // ============================================
  // SYSTEM DESIGN PATTERNS (Week 20)
  // ============================================

  // Week 20: Scalability
  {
    type: 'system_design',
    weekNumber: 20,
    patternName: 'Scalability & Performance',
    coreTemplate:
      'Design a system that handles millions of users with high availability and low latency.',
    learningObjectives: ['Scalability', 'Load balancing', 'Caching', 'Database sharding'],
    relatedTags: ['scalability', 'load-balancing', 'caching'],
  },
];
