export type NotionTokenSource = 'none' | 'environment' | 'keychain';

export interface NotionConfigInput {
	token?: string;
	databaseIdOrUrl: string;
	datePropertyName: string;
	titlePropertyName: string;
	timezone: string;
}

export interface NotionConfig extends Omit<NotionConfigInput, 'token'> {
	hasToken: boolean;
	tokenSource: NotionTokenSource;
}

export interface NotionDatabaseSetupInput {
	token?: string;
	parentPageIdOrUrl: string;
	databaseName: string;
	datePropertyName: string;
	titlePropertyName: string;
	timezone: string;
}

export interface NotionDatabaseSetupResult {
	ok: boolean;
	message: string;
	databaseId: string;
	databaseUrl: string;
	datePropertyName: string;
	titlePropertyName: string;
	timezone: string;
}
