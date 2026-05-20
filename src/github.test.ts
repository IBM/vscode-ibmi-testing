import * as fs from 'fs';
import * as path from "path";

// Mock dependencies before importing the module to test
jest.mock('octokit', () => {
  const mockListReleases = jest.fn();
  const mockOctokitInstance = {
    rest: {
      repos: {
        listReleases: mockListReleases
      }
    }
  };
  
  return {
    Octokit: jest.fn(() => mockOctokitInstance)
  };
});

jest.mock('node-fetch', () => ({
  default: jest.fn()
}));

jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn(),
  },
}));

jest.mock('path', () => ({
  join: jest.fn(),
}));

describe('GitHub', () => {
  // Import the module after mocks are set up
  let GitHubModule: typeof import('./github');
  let GitHub: typeof import('./github').GitHub;
  let mockOctokit: jest.Mock;
  let mockListReleases: jest.Mock;
  let mockedFetch: jest.Mock;
  let mockedFsPromises: jest.Mocked<typeof import('fs').promises>;
  let mockedPath: jest.Mocked<typeof import('path')>;

  const mockOwner = 'tools-400';
  const mockRepo = 'irpgunit';
  const mockAssetName = 'RPGUNIT.SAVF';

  beforeAll(async () => {
    // Import after mocking dependencies
    GitHubModule = await import('./github');
    GitHub = GitHubModule.GitHub;
    
    // Now we can access the mocked dependencies
    const octokitModule = require('octokit');
    mockOctokit = octokitModule.Octokit as jest.Mock;
    
    // Get the mock functions
    mockedFetch = require('node-fetch').default as jest.Mock;
    mockedFsPromises = require('fs').promises as jest.Mocked<typeof import('fs').promises>;
    mockedPath = require('path') as jest.Mocked<typeof import('path')>;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create a fresh mock instance for each test
    const mockListReleasesNew = jest.fn();
    const mockOctokitInstance = {
      rest: {
        repos: {
          listReleases: mockListReleasesNew
        }
      }
    };
    mockOctokit.mockImplementation(() => mockOctokitInstance);
    mockListReleases = mockListReleasesNew;
  });

  describe('constants', () => {
    it('should have correct owner', () => {
      expect(GitHub.OWNER).toBe(mockOwner);
    });

    it('should have correct repo', () => {
      expect(GitHub.REPO).toBe(mockRepo);
    });

    it('should have correct asset name', () => {
      expect(GitHub.ASSET_NAME).toBe(mockAssetName);
    });
  });

  describe('getReleases', () => {
    it('should return releases when API call is successful', async () => {
      const mockReleases = [
        {
          id: 1,
          node_id: 'test-node-id',
          url: 'https://api.github.com/repos/tools-400/irpgunit/releases/1',
          html_url: 'https://github.com/tools-400/irpgunit/releases/v1.0.0',
          assets_url: 'https://api.github.com/repos/tools-400/irpgunit/releases/1/assets',
          upload_url: 'https://uploads.github.com/repos/tools-400/irpgunit/releases/1/assets',
          tarball_url: null,
          zipball_url: null,
          tag_name: 'v1.0.0',
          target_commitish: 'main',
          name: 'Version 1.0.0',
          body: 'Release notes',
          draft: false,
          prerelease: false,
          created_at: '2023-09-20T11:00:00Z',
          published_at: '2023-09-20T12:00:00Z',
          author: {
            login: 'test-author',
            id: 1,
            node_id: 'test-node-id',
            avatar_url: 'https://example.com/avatar.jpg',
            gravatar_id: '',
            url: 'https://api.github.com/users/test-author',
            html_url: 'https://github.com/test-author',
            followers_url: 'https://api.github.com/users/test-author/followers',
            following_url: 'https://api.github.com/users/test-author/following{/other_user}',
            gists_url: 'https://api.github.com/users/test-author/gists{/gist_id}',
            starred_url: 'https://api.github.com/users/test-author/starred{/owner}{/repo}',
            subscriptions_url: 'https://api.github.com/users/test-author/subscriptions',
            organizations_url: 'https://api.github.com/users/test-author/orgs',
            repos_url: 'https://api.github.com/users/test-author/repos',
            events_url: 'https://api.github.com/users/test-author/events{/privacy}',
            received_events_url: 'https://api.github.com/users/test-author/received_events',
            type: 'User',
            site_admin: false,
          },
          assets: [],
        }
      ];

      mockListReleases.mockResolvedValue({
        status: 200,
        data: mockReleases
      });

      const result = await GitHub.getReleases();

      expect(result.data).toEqual(mockReleases);
      expect(result.error).toBeUndefined();
      expect(mockOctokit).toHaveBeenCalledTimes(1);
      expect(mockListReleases).toHaveBeenCalledWith({
        owner: mockOwner,
        repo: mockRepo
      });
    });

    it('should handle non-200 HTTP status', async () => {
      mockListReleases.mockResolvedValue({
        status: 404,
        data: []
      });

      const result = await GitHub.getReleases();

      expect(result.data).toEqual([]);
      expect(result.error).toBe(404);
    });

    it('should handle API errors', async () => {
      const errorMessage = 'Network error';
      mockListReleases.mockRejectedValue(new Error(errorMessage));

      const result = await GitHub.getReleases();

      expect(result.data).toEqual([]);
      expect(result.error).toBe(errorMessage);
    });

    it('should handle generic error', async () => {
      const genericError = 'Something went wrong';
      mockListReleases.mockRejectedValue(genericError);

      const result = await GitHub.getReleases();

      expect(result.data).toEqual([]);
      expect(result.error).toBe(genericError);
    });
  });

  describe('downloadReleaseAsset', () => {
    const mockAsset = {
      id: 1,
      node_id: 'test-node-id',
      url: 'https://api.github.com/repos/tools-400/irpgunit/releases/assets/1',
      browser_download_url: 'https://example.com/download/test-asset.zip',
      name: 'test-asset.zip',
      label: 'Test Asset',
      state: 'uploaded' as const,
      content_type: 'application/zip',
      size: 1024,
      download_count: 10,
      created_at: '2023-09-20T12:00:00Z',
      updated_at: '2023-09-20T12:00:00Z',
      uploader: {
        login: 'test-author',
        id: 1,
        node_id: 'test-node-id',
        avatar_url: 'https://example.com/avatar.jpg',
        gravatar_id: '',
        url: 'https://api.github.com/users/test-author',
        html_url: 'https://github.com/test-author',
        followers_url: 'https://api.github.com/users/test-author/followers',
        following_url: 'https://api.github.com/users/test-author/following{/other_user}',
        gists_url: 'https://api.github.com/users/test-author/gists{/gist_id}',
        starred_url: 'https://api.github.com/users/test-author/starred{/owner}{/repo}',
        subscriptions_url: 'https://api.github.com/users/test-author/subscriptions',
        organizations_url: 'https://api.github.com/users/test-author/orgs',
        repos_url: 'https://api.github.com/users/test-author/repos',
        events_url: 'https://api.github.com/users/test-author/events{/privacy}',
        received_events_url: 'https://api.github.com/users/test-author/received_events',
        type: 'User',
        site_admin: false,
      },
    };

    const mockDownloadDirectory = '/downloads';
    const mockFilePath = '/downloads/test-asset.zip';

    it('should download asset successfully when fetch succeeds', async () => {
      const mockArrayBuffer = new ArrayBuffer(10);
      const mockBuffer = Buffer.from(mockArrayBuffer);
      const mockResponse = {
        status: 200,
        arrayBuffer: jest.fn().mockResolvedValue(mockArrayBuffer)
      };

      mockedFetch.mockResolvedValue(mockResponse as any);
      mockedPath.join.mockReturnValue(mockFilePath);
      mockedFsPromises.writeFile.mockResolvedValue(undefined);

      const result = await GitHub.downloadReleaseAsset(mockAsset, mockDownloadDirectory);

      expect(result.data).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockedFetch).toHaveBeenCalledWith(mockAsset.browser_download_url);
      expect(mockedPath.join).toHaveBeenCalledWith(mockDownloadDirectory, mockAsset.name);
      expect(mockedFsPromises.writeFile).toHaveBeenCalledWith(mockFilePath, mockBuffer);
    });

    it('should handle download failure when fetch returns non-200 status', async () => {
      const mockResponse = {
        status: 404,
        statusText: 'Not Found',
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(10))
      };

      mockedFetch.mockResolvedValue(mockResponse as any);

      const result = await GitHub.downloadReleaseAsset(mockAsset, mockDownloadDirectory);

      expect(result.data).toBe(false);
      expect(result.error).toBe('Not Found');
    });

    it('should handle network error during fetch', async () => {
      const errorMessage = 'Network error';
      mockedFetch.mockRejectedValue(new Error(errorMessage));

      const result = await GitHub.downloadReleaseAsset(mockAsset, mockDownloadDirectory);

      expect(result.data).toBe(false);
      expect(result.error).toBe(errorMessage);
    });

    it('should handle generic error during fetch', async () => {
      const genericError = 'Something went wrong';
      mockedFetch.mockRejectedValue(genericError);

      const result = await GitHub.downloadReleaseAsset(mockAsset, mockDownloadDirectory);

      expect(result.data).toBe(false);
      expect(result.error).toBe(genericError);
    });
  });
});