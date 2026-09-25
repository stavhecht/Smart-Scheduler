const awsConfig = {
    Auth: {
        Cognito: {
            userPoolId: 'us-east-1_xXvw25dyY',
            userPoolClientId: '1a08kdegveiqjkgln01p3eqa7u',
            region: 'us-east-1',
            loginWith: {
                email: true
            }
        }
    }
};

export default awsConfig;
