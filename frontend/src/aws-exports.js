const awsConfig = {
    Auth: {
        Cognito: {
            userPoolId: 'us-east-1_jniG91JWu',
            userPoolClientId: '7bvuocrmltcghptnh20gv63rq6',
            region: 'us-east-1',
            loginWith: {
                email: true
            }
        }
    }
};

export default awsConfig;
