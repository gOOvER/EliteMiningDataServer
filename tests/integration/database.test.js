// Integration test example for database operations
const mongoose = require('mongoose')

// Helper to check if MongoDB is available
const isMongoAvailable = () => {
  return process.env.CI || process.env.GITHUB_ACTIONS
}

// Use conditional describe to skip if MongoDB not available
const describeIfMongo = isMongoAvailable() ? describe : describe.skip

describeIfMongo('Database Integration', () => {
  beforeAll(async () => {
    // Connect to test database
    if (!mongoose.connection.readyState) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://testuser:testpass123@localhost:27017/elite_mining_test?authSource=admin', {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000
      })
    }
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect()
    }
  })

  describe('MongoDB Connection', () => {
    test('should be connected to test database', () => {
      expect(mongoose.connection.readyState).toBe(1) // 1 = connected
    })

    test('should use test database', () => {
      const dbName = mongoose.connection.name
      expect(dbName).toMatch(/test/i)
    })
  })

  describe('Basic Operations', () => {
    test('should create and retrieve a test document', async () => {
      // Define a simple test schema
      const TestSchema = new mongoose.Schema({
        name: String,
        value: Number,
        createdAt: { type: Date, default: Date.now }
      })

      // Create model (will be cleaned up after test)
      const TestModel = mongoose.model('IntegrationTest', TestSchema)

      // Create a test document
      const testDoc = new TestModel({
        name: 'test-document',
        value: 42
      })

      const savedDoc = await testDoc.save()
      expect(savedDoc._id).toBeDefined()
      expect(savedDoc.name).toBe('test-document')
      expect(savedDoc.value).toBe(42)

      // Retrieve the document
      const foundDoc = await TestModel.findById(savedDoc._id)
      expect(foundDoc).toBeTruthy()
      expect(foundDoc.name).toBe('test-document')

      // Clean up
      await TestModel.deleteOne({ _id: savedDoc._id })
    })

    test('should handle database operations with proper cleanup', async () => {
      // Define another test schema
      const CleanupSchema = new mongoose.Schema({
        title: String,
        count: Number
      })

      const CleanupModel = mongoose.model('CleanupTest', CleanupSchema)

      // Create multiple documents
      const docs = await CleanupModel.create([
        { title: 'doc1', count: 1 },
        { title: 'doc2', count: 2 },
        { title: 'doc3', count: 3 }
      ])

      // Verify they exist
      expect(docs).toHaveLength(3)
      const foundDocs = await CleanupModel.find()
      expect(foundDocs).toHaveLength(3)

      // Clean up all test documents
      await CleanupModel.deleteMany({})
    })
  })

  describe('Environment Configuration', () => {
    test('should have test environment configured', () => {
      expect(process.env.NODE_ENV).toBe('test')
      expect(process.env.MONGODB_URI).toBeDefined()
      expect(process.env.MONGODB_URI).toMatch(/test/i)
    })
  })
})

// If MongoDB is not available, show a message
if (!isMongoAvailable()) {
  console.log('⚠️ MongoDB not available, skipping database integration tests')
  console.log('💡 To run database tests, ensure MongoDB is running in CI environment')
}