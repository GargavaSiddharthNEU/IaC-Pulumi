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

// Exporting the VPC id for reference.
export const exportedVpcId = vpc.id;

