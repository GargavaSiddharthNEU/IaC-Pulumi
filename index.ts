import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// Setup Pulumi Config
const config = new pulumi.Config();

const vpcCidr = config.require("vpcCidr");
const region = config.require("region");
const subnetCount = config.getNumber("subnetCount") || 3;  // Default to 3 if not set
const publicSubnetBaseCIDR = config.require("publicSubnetBaseCIDR");
const privateSubnetBaseCIDR = config.require("privateSubnetBaseCIDR");
const vpcNameF = config.require("vpcName");
const igwNameF = config.require("igwName");
const publicrouteNameF = config.require("publicrouteName");
const privaterouteNameF = config.require("privaterouteName");
const dbPassword = config.requireSecret("dbPassword");
const dbUser = config.require("dbUser");
const dbPostgresql = config.require("dbPostgresql");

// Assuming you have the hosted zone ID as a Pulumi config value
const hostedZoneId = config.require("hostedZoneId");


// Generate subnet CIDRs dynamically
// const generateSubnetCidrs = (base: string, count: number): string[] => {
//     const baseParts = base.split(".");
//     const thirdOctet = parseInt(baseParts[2], 10);
//     return Array.from({ length: count }, (_, i) => `${baseParts[0]}.${baseParts[1]}.${thirdOctet + i}.0/24`);
// }

const availabilityZones = aws.getAvailabilityZones();

const determineSubnetCount = availabilityZones.then(azs => {
    if (azs.names.length < subnetCount) {
        return azs.names.length;
    }
    return subnetCount;
});

const generateSubnetCidrsAsync = (base: string, countPromise: Promise<number>): Promise<string[]> => {
    return countPromise.then(count => {
        const baseParts = base.split(".");
        const thirdOctet = parseInt(baseParts[2], 10);
        return Array.from({ length: count }, (_, i) => `${baseParts[0]}.${baseParts[1]}.${thirdOctet + i}.0/24`);
    });
}


const publicSubnetCidrsPromise = generateSubnetCidrsAsync(publicSubnetBaseCIDR, determineSubnetCount);
const privateSubnetCidrsPromise = generateSubnetCidrsAsync(privateSubnetBaseCIDR, determineSubnetCount);

// 1. Create Virtual Private Cloud (VPC).
const vpc = new aws.ec2.Vpc("myVpc", {
    cidrBlock: vpcCidr,
    tags:{
        Name: vpcNameF
        //Name:`vpc-${pulumi.getStack()}`
    }
});

// 2. Create subnets in your VPC.
const createSubnet = (name: string, cidr: string, az: string, isPublic: boolean) => {
    return new aws.ec2.Subnet(name, {
        vpcId: vpc.id,
        cidrBlock: cidr,
        availabilityZone: az,
        mapPublicIpOnLaunch: isPublic,
    });
};




// const publicSubnets = publicSubnetCidrs.map((cidr: string, idx: number) => {
//     // Use the fetched availability zones for the subnets
//     return availabilityZones.then((azs: any) => {
//         return createSubnet(`publicSubnet-${idx}`, cidr, azs.names[idx], true);
//     });
// });

const publicSubnets = pulumi.all([publicSubnetCidrsPromise, availabilityZones])
    .apply(([cidrs, azs]) => cidrs.map((cidr: string, idx: number) => {
        return createSubnet(`publicSubnet-${idx}`, cidr, azs.names[idx], true);
    }));

// const privateSubnets = privateSubnetCidrs.map((cidr: string, idx: number) => {
//     // Use the fetched availability zones for the subnets
//     return availabilityZones.then((azs: any) => {
//         return createSubnet(`privateSubnet-${idx}`, cidr, azs.names[idx], true);
//     });
// });

const privateSubnets = pulumi.all([privateSubnetCidrsPromise, availabilityZones])
    .apply(([cidrs, azs]) => cidrs.map((cidr: string, idx: number) => {
        return createSubnet(`privateSubnet-${idx}`, cidr, azs.names[idx], false);
    }));

// 3. Create an Internet Gateway resource and attach it to the VPC.
const internetGateway = new aws.ec2.InternetGateway("AssignmentInternetGateway", {
    vpcId: vpc.id,
    tags:{
        Name:igwNameF
        //Name:`igw-${pulumi.getStack()}`
    }
});

// 4. Create a public route table and associate public subnets.
const publicRouteTable = new aws.ec2.RouteTable("publicRouteTable", {
    vpcId: vpc.id,
    tags:{
        Name:publicrouteNameF
        //Name:`public_route_table-${pulumi.getStack()}`
    }
});


// Promise.all(publicSubnets).then(resolvedSubnets => {
//     resolvedSubnets.forEach((subnet: aws.ec2.Subnet, idx: number) => {
//         new aws.ec2.RouteTableAssociation(`publicRta-${idx}`, {
//             subnetId: subnet.id,
//             routeTableId: publicRouteTable.id,
//         });
//     });
// });

pulumi.all([publicSubnets, publicRouteTable]).apply(([subnets, rt]) => {
    subnets.forEach((subnet, idx) => {
        new aws.ec2.RouteTableAssociation(`publicRta-${idx}`, {
            subnetId: subnet.id,
            routeTableId: rt.id,
        });
    });
});

// 5. Create a private route table and associate private subnets.
const privateRouteTable = new aws.ec2.RouteTable("privateRouteTable", {
    vpcId: vpc.id,
    tags:{
        Name:privaterouteNameF
        //Name:`private_route_table-${pulumi.getStack()}`
    }
});


// Promise.all(privateSubnets).then(resolvedSubnets => {
//     resolvedSubnets.forEach((subnet: aws.ec2.Subnet, idx: number) => {
//         new aws.ec2.RouteTableAssociation(`privateRta-${idx}`, {
//             subnetId: subnet.id,
//             routeTableId: privateRouteTable.id,
//         });
//     });
// });

pulumi.all([privateSubnets, privateRouteTable]).apply(([subnets, rt]) => {
    subnets.forEach((subnet, idx) => {
        new aws.ec2.RouteTableAssociation(`privateRta-${idx}`, {
            subnetId: subnet.id,
            routeTableId: rt.id,
        });
    });
});

// 6. Create a public route in the public route table.
const publicRoute = new aws.ec2.Route("publicRoute", {
    routeTableId: publicRouteTable.id,
    destinationCidrBlock: "0.0.0.0/0",
    gatewayId: internetGateway.id,
});

const appSecurityGroup = new aws.ec2.SecurityGroup("AppSecurityGroup", {
    vpcId: vpc.id,
    description: "Security group for web applications",
    ingress: [
        { protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 8080, toPort: 8080, cidrBlocks: ["0.0.0.0/0"] }
    ],
    egress: [
        {
            protocol: "-1",
            fromPort: 0,
            toPort: 0,
            cidrBlocks: ["0.0.0.0/0"]
        }
    ],
    tags: {
        Name: "ApplicationSecurityGroup",
        // Other relevant tags can be added here
    }
});

// 8. EC2 Instance
// const ec2Instance = new aws.ec2.Instance("AppEC2Instance", {
//     ami: "ami-07e7ef52cc5f8246d",  // Replace with your custom AMI ID
//     instanceType: "t2.micro",   // Choose any appropriate instance type
//     keyName: "ec2-aws-test",   // Replace with your SSH key name if you have one
//     vpcSecurityGroupIds: [appSecurityGroup.id],
//     subnetId: publicSubnets[0].id,  // Launching in the first public subnet as an example
//     rootBlockDevice: {
//         volumeType: "gp2",
//         volumeSize: 25,
//         deleteOnTermination: true
//     },
//     disableApiTermination: false,
//     tags: {
//         Name: "AppEC2Instance",
//         // Other relevant tags can be added here
//     }
// });

const latestAmiPromise = aws.ec2.getAmi({
    mostRecent: true,
    filters: [
        {
            name: 'state',
            values: ['available'],
        },
    ],
    owners: ["388344348771"],
});

const latestAmi = pulumi.output(latestAmiPromise);


//Assignment-6

    const rdsSecurityGroup = new aws.ec2.SecurityGroup("RdsSecurityGroup", {
        vpcId: vpc.id,
        description: "Security group for RDS instances",
        ingress: [
            {
                protocol: "tcp",
                fromPort: 5432,
                toPort: 5432,
                securityGroups: [appSecurityGroup.id]  // Allowing traffic from the application security group
            }
        ],
        tags: {
            Name: "DatabaseSecurityGroup"
        }
    });

    const rdsParameterGroup = new aws.rds.ParameterGroup("rdsparametergroup", {
        family: "postgres15",  // For PostgreSQL 12, update this according to your version
        // parameters: [
        //     {
        //         name: "max_connections",
        //         value: "100",
        //         applyMethod: "pending-reboot"
        //     },
        // ],
        tags: {
            Name: "rdsparametergroup"
        }
    });

    const dbSubnetGroupName = "csye-db-subnet-group"

    const rdsSubnetGroup = new aws.rds.SubnetGroup(dbSubnetGroupName, {

        subnetIds: [privateSubnets[0].id, privateSubnets[1].id],

    });

    const rdsInstance = new aws.rds.Instance("RDSInstance", {
        engine: "postgres",
        instanceClass: "db.t3.micro",
        allocatedStorage: 20,
        name: dbPostgresql,
        username: dbUser,
        password: dbPassword,
        parameterGroupName: rdsParameterGroup.name,
        skipFinalSnapshot: true,
        dbSubnetGroupName: rdsSubnetGroup.name, // DB subnet group using the private subnets
        vpcSecurityGroupIds: [rdsSecurityGroup.id],
        multiAz: false,
        publiclyAccessible: false,
        identifier: "csye6225",
        tags: {
            Name: "RDSInstance"
        }
    });
    
    //Assignment-7
    // CloudWatch Agent IAM Role and Policy Attachment
    const cloudwatchAgentRole = new aws.iam.Role("cloudwatchAgentRole", {
        assumeRolePolicy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [{
                Action: 'sts:AssumeRole',
                Principal: {
                    Service: 'ec2.amazonaws.com'
                },
                Effect: 'Allow',
            }]
        })
    });

    const policyAttachment = new aws.iam.RolePolicyAttachment('cloudWatchAgentPolicyAttachment', {
        role: cloudwatchAgentRole.name,
        policyArn: 'arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy'
    });

    // Create an IAM Instance Profile for our EC2 instance
    const cloudwatchAgentInstanceProfile = new aws.iam.InstanceProfile("cloudwatchAgentInstanceProfile", {
        role: cloudwatchAgentRole.name,
    });


    //Fetch your Route53 Hosted Zone using the hostedZoneId
    const hostedZone = aws.route53.getZone({ zoneId: hostedZoneId });
    
// 8. EC2 Instance
const ec2Instance = new aws.ec2.Instance("AppEC2Instance", {
    ami: latestAmi.apply(ami => ami.id),  
    instanceType: "t2.micro",   // Choosing instance type
    keyName: "ec2-aws-test",   // Add SSH key
    vpcSecurityGroupIds: [appSecurityGroup.id],
    iamInstanceProfile: cloudwatchAgentInstanceProfile.name,
    subnetId: publicSubnets[0].id,  // Launching in the first public subnet
    rootBlockDevice: {
        volumeType: "gp2",
        volumeSize: 25,
        deleteOnTermination: true
    },
    disableApiTermination: false,
    userData: pulumi.interpolate`#!/bin/bash
    cd /opt/webapp
    rm .env
    touch .env
    echo DB_HOST=${rdsInstance.address} >> /opt/webApp/.env
    echo DB_POSTGRESQL=${dbPostgresql} >> /opt/webApp/.env
    echo DB_USER=${dbUser} >> /opt/webApp/.env
    echo DB_PASSWORD=${dbPassword} >> /opt/webApp/.env
    sudo systemctl restart webApp.service
    sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -c file:/opt/webApp/AmazonCloudWatch-cloudwatch-config.json \
    -s
    sudo systemctl enable amazon-cloudwatch-agent
    sudo systemctl start amazon-cloudwatch-agent`,
    // dependsOn: [rdsDatabase],
    tags: {
        Name: "AppEC2Instance",
    }
});



    // 2. Create/Update the A record for your EC2 instance within the Hosted Zone
    const domainName = "siddharthgargava.me"; // Replace with your domain name
    const subdomainName = "demos"; // Subdomain for the EC2 instance. Change this if required.

    const aRecord = new aws.route53.Record(`${subdomainName}.${domainName}`, {
        zoneId: hostedZoneId,
        name: "demos.siddharthgargava.me",
        type: "A",
        ttl: 60,
        records: [ec2Instance.publicIp], // This ties the EC2 instance's public IP to the A record
    });
//Assignment-7 end

//Assignment-6 End

// Exporting the VPC id for reference.
export const exportedVpcId = vpc.id;

