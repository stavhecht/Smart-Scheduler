const awsConfig = {
    Auth: {
        Cognito: {
            userPoolId: 'us-east-1_7WEqkrFxi',
            userPoolClientId: '2paaps49hvf17r9kskfo2d151u',
            region: 'us-east-1',
            loginWith: {
                email: true
            }
        }
    }
};

export default awsConfig;
